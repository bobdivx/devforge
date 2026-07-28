<?php

namespace App\Services\DevForge\Agent;

use App\Enums\TaskModelTier;
use App\Events\AgentRunUpdated;
use App\Models\AiAgent;
use App\Models\AiAgentRun;
use App\Services\DevForge\Agent\Contracts\LlmResponse;
use App\Services\DevForge\Agent\Tool\AgentSubagentRegistry;
use App\Services\DevForge\Agent\Tool\AgentToolApprovalGrant;
use App\Services\DevForge\Agent\Tool\IterationBudget;
use App\Services\DevForge\Core\CoreResourceAction;
use App\Services\DevForge\Core\CoreResourceCatalog;
use App\Services\DevForge\DeploymentData;
use App\Services\DevForge\Readiness\ApplicationReadinessService;

class AgentRunner
{
    /** @var array<array{role: string, content: string}> */
    private array $messages = [];

    private bool $toolNudgeUsed = false;

    private bool $correctionNudgeUsed = false;

    private bool $anyToolUsed = false;

    private bool $harnessUsed = false;

    public function __construct(
        private readonly LlmProviderFactory $providerFactory,
        private readonly CoreResourceCatalog $catalog,
        private readonly CoreResourceAction $resourceAction,
        private readonly DeploymentData $deploymentData,
        private readonly AgentPromptBuilder $promptBuilder,
        private readonly TaskModelRouter $taskModelRouter,
    ) {}

    public function run(AiAgent $agent, AiAgentRun $run, array $context = []): void
    {
        $this->toolNudgeUsed = false;
        $this->correctionNudgeUsed = false;
        $this->anyToolUsed = false;
        $this->harnessUsed = false;
        $providerConfig = $agent->effectiveProviderConfig();

        if (! $providerConfig) {
            $run->update([
                'status' => 'failed',
                'summary' => 'Aucun provider LLM configuré pour cet agent.',
                'finished_at' => now(),
            ]);
            $agent->update(['status' => 'error']);

            return;
        }

        $taskMessage = (string) ($context['delegated_goal'] ?? $context['user_message'] ?? '');
        $tier = $context['task_tier'] ?? null;
        if (! $tier instanceof TaskModelTier) {
            $tier = $this->taskModelRouter->classify($taskMessage, $run->trigger, $agent->type, $context);
        }

        $reason = $this->taskModelRouter->reason($taskMessage, $run->trigger, $agent->type, $context, $tier);
        $routing = $this->taskModelRouter->routingPayload($tier, $reason);
        $run->mergeMetadata([
            'model_routing' => $routing,
            'ephemeral' => (bool) ($context['ephemeral'] ?? false),
            'parent_run_uuid' => $context['parent_run_uuid'] ?? null,
        ]);

        // Marquer running avant l'init provider (peut être lent : healthcheck Ollama, etc.)
        $run->update(['status' => 'running', 'started_at' => now()]);
        $run->appendLog('Agent démarré — '.$routing['display'].' ('.$routing['tier_label'].')');
        $run->appendLog('Modèle LLM : '.$this->providerFactory->describeResolvedModel($providerConfig));
        $run->appendLog('Routage : '.$reason);
        $run->appendLog('Initialisation du provider LLM...');

        foreach ($context['approved_approval_keys'] ?? [] as $approvalKey) {
            if (is_string($approvalKey) && $approvalKey !== '') {
                AgentToolApprovalGrant::grantForRun((int) $run->id, $approvalKey);
                $run->appendLog('Approbation pré-accordée pour la clé '.mb_substr($approvalKey, 0, 12).'…');
            }
        }

        $provider = $this->providerFactory->makeForAgent(
            $agent,
            function (\Throwable $exception, string $primaryLabel, string $fallbackLabel) use ($run): void {
                $run->appendLog("Provider {$primaryLabel} indisponible : ".mb_substr($exception->getMessage(), 0, 200));
                $run->appendLog("Bascule vers le provider de secours : {$fallbackLabel}");
            },
            config('devforge.agents_smart_routing', true) ? $tier : null,
        );
        $run->appendLog('Provider LLM prêt.');

        $delegator = new AgentDelegator($this, new AgentSubagentRegistry, $this->taskModelRouter);
        $toolkit = new AgentToolkit(
            team: $agent->team,
            run: $run,
            catalog: $this->catalog,
            resourceAction: $this->resourceAction,
            deploymentData: $this->deploymentData,
            agent: $agent,
            assignedResourceUuid: $agent->resource_uuid,
            runContext: $context,
            delegator: $delegator,
        );

        $this->messages = [
            ['role' => 'system', 'content' => $this->promptBuilder->autonomousSystemPrompt($agent, $context)],
            ['role' => 'user', 'content' => $this->promptBuilder->autonomousInitialMessage($agent, $context, $run->trigger)],
        ];

        $budget = new IterationBudget((int) config('devforge.agents_max_iterations', 30));
        $summary = '';

        try {
            $this->maybeAutoFixDeploymentInfrastructure($toolkit, $run, $context);

            $earlyHarness = $this->maybeRunEarlyDeterministicHarness($toolkit, $agent, $run, $context);
            if ($earlyHarness !== null) {
                $summary = $earlyHarness['text'];
                $run->update([
                    'status' => 'completed',
                    'summary' => mb_substr($summary, 0, 1000),
                    'finished_at' => now(),
                ]);
                app(AgentRunCorrectionSummarizer::class)->finalize($run->fresh() ?? $run);
                app(ApplicationReadinessService::class)->handleAgentOutcome($run->fresh() ?? $run);
                $this->publishOverviewInterventionReport($agent, $run->fresh() ?? $run, $context);
                $agent->update(['status' => 'idle', 'last_run_at' => now()]);
                broadcast(new AgentRunUpdated($agent, $run->fresh() ?? $run, 'completed'));

                return;
            }

            while ($budget->consume()) {
                $iterations = $budget->getUsed();
                $run->appendLog("Itération #{$iterations}...");

                broadcast(new AgentRunUpdated($agent, $run, "Itération #{$iterations}"));

                /** @var LlmResponse $response */
                $response = $provider->chat($this->messages, $toolkit->definitions());

                $run->update([
                    'tokens_used' => $run->tokens_used + $response->tokensUsed,
                    'iterations' => $iterations,
                ]);

                if ($response->text) {
                    $run->appendLog("Raisonnement: {$response->text}");
                    $summary = $response->text;
                }

                if (! $response->hasToolCalls()) {
                    if (! $this->anyToolUsed && ! $this->toolNudgeUsed) {
                        $this->toolNudgeUsed = true;
                        $this->messages[] = ['role' => 'assistant', 'content' => $response->text ?: 'En attente d\'action.'];
                        $this->messages[] = ['role' => 'user', 'content' => AgentDirectives::toolNudgeMessage()];
                        $run->appendLog('Relance autonome : premier tour sans outil — nouvelle consigne envoyée.');

                        continue;
                    }

                    $correctionActions = $run->metadata['correction_actions'] ?? [];
                    $assistantText = (string) ($response->text ?? '');
                    if (
                        ($context['event'] ?? null) === 'deployment_failed'
                        && ! $this->correctionNudgeUsed
                        && (! is_array($correctionActions) || $correctionActions === [])
                        && ! AgentDirectives::isHostPermissionDiagnosis($assistantText)
                    ) {
                        $this->correctionNudgeUsed = true;
                        $this->messages[] = ['role' => 'assistant', 'content' => $assistantText !== '' ? $assistantText : 'Diagnostic terminé.'];
                        $this->messages[] = ['role' => 'user', 'content' => AgentDirectives::deploymentFailureCorrectionNudgeMessage($assistantText)];
                        $run->appendLog('Relance autonome : échec déploiement sans correction — consigne corrective envoyée.');

                        continue;
                    }

                    if (
                        ($context['event'] ?? null) === 'deployment_failed'
                        && ! $this->correctionNudgeUsed
                        && AgentDirectives::isHostPermissionDiagnosis($assistantText)
                    ) {
                        $this->correctionNudgeUsed = true;
                        $this->messages[] = ['role' => 'assistant', 'content' => $assistantText];
                        $this->messages[] = ['role' => 'user', 'content' => AgentDirectives::deploymentFailureHostPermissionNudgeMessage()];
                        $run->appendLog('Relance autonome : Permission denied hôte — consigne ops (pas de variable factice).');

                        continue;
                    }

                    // Même après get_deployment_logs (anyToolUsed=true) : si aucune
                    // correction enregistrée, forcer le harness déterministe.
                    $run->refresh();
                    $harnessText = $this->tryRepairHarnessFallback(
                        $toolkit,
                        $agent,
                        $run,
                        $context,
                        'Corriger le déploiement en échec',
                        'Harness autonome : réparation déterministe après diagnostic sans correction.',
                    );
                    if ($harnessText !== null) {
                        $summary = $harnessText;
                        break;
                    }

                    $run->appendLog('Agent terminé — aucun appel d\'outil supplémentaire.');
                    break;
                }

                $this->anyToolUsed = true;
                $toolResults = [];
                $hadToolFailure = false;
                $waitingForInput = false;
                $pendingApproval = null;

                foreach ($response->toolCalls as $toolCall) {
                    if ($pendingApproval !== null) {
                        $toolResults[] = [
                            'name' => $toolCall['name'],
                            'result' => [
                                'error' => 'En attente d’approbation — exécution reportée.',
                                'skipped' => true,
                            ],
                        ];
                        $hadToolFailure = true;

                        continue;
                    }

                    $result = $toolkit->execute($toolCall['name'], $toolCall['arguments']);
                    if (isset($result['error'])) {
                        $hadToolFailure = true;
                    }
                    if (($result['status'] ?? '') === 'waiting_for_input') {
                        $waitingForInput = true;
                    }
                    if (($result['status'] ?? null) === 'ask' || ! empty($result['pending_approval'])) {
                        $pendingApproval = [
                            'status' => 'ask',
                            'tool' => (string) ($result['tool'] ?? $toolCall['name']),
                            'reason' => (string) ($result['reason'] ?? 'Approbation requise.'),
                            'rule_id' => (string) ($result['rule_id'] ?? ''),
                            'approval_key' => (string) ($result['approval_key'] ?? ''),
                        ];
                        if (is_array($result['diff_preview'] ?? null)) {
                            $pendingApproval['diff_preview'] = $result['diff_preview'];
                        }
                    }
                    $toolResults[] = [
                        'name' => $toolCall['name'],
                        'result' => $result,
                    ];
                }

                if (! $hadToolFailure) {
                    $budget->refund();
                }

                AgentToolTurnBuilder::append($this->messages, $response, $toolResults);

                if ($pendingApproval !== null) {
                    $toolLabel = $pendingApproval['tool'];
                    $summary = "⏸ Approbation requise pour l’outil « {$toolLabel} ».\n"
                        .$pendingApproval['reason'];
                    $run->mergeMetadata(['pending_approval' => $pendingApproval]);
                    $run->update([
                        'status' => 'awaiting_approval',
                        'summary' => mb_substr($summary, 0, 1000),
                        'finished_at' => now(),
                    ]);
                    $run->appendLog("Run en pause — approbation requise pour « {$toolLabel} ».");
                    app(AgentRunCorrectionSummarizer::class)->finalize($run->fresh() ?? $run);
                    $this->publishOverviewInterventionReport($agent, $run->fresh() ?? $run, $context);
                    $agent->update(['status' => 'idle', 'last_run_at' => now()]);
                    broadcast(new AgentRunUpdated($agent, $run->fresh() ?? $run, 'awaiting_approval'));

                    return;
                }

                if ($waitingForInput) {
                    $run->update([
                        'status' => 'waiting_for_input',
                        'summary' => 'En attente de saisie utilisateur.',
                        'finished_at' => now(), // Technically paused, but finished for this job execution
                    ]);
                    $this->publishOverviewInterventionReport($agent, $run->fresh() ?? $run, $context);
                    $agent->update(['status' => 'idle', 'last_run_at' => now()]);
                    broadcast(new AgentRunUpdated($agent, $run->fresh() ?? $run, 'waiting_for_input'));
                    return;
                }
            }

            if ($budget->getRemaining() === 0) {
                $run->appendLog('Limite d\'itérations atteinte.');
                $run->refresh();
                $harnessText = $this->tryRepairHarnessFallback(
                    $toolkit,
                    $agent,
                    $run,
                    $context,
                    'Corriger le déploiement en échec (budget épuisé)',
                    'Harness autonome : réparation déterministe après budget épuisé sans correction.',
                );
                if ($harnessText !== null) {
                    $summary = $harnessText;
                } else {
                    $summary = $summary ?: 'Limite d\'itérations atteinte sans conclusion.';
                }
            }

            $pendingApproval = is_array($run->metadata['pending_approval'] ?? null)
                ? $run->metadata['pending_approval']
                : null;

            if ($pendingApproval !== null) {
                $toolLabel = (string) ($pendingApproval['tool'] ?? 'outil');
                $summary = "⏸ Approbation requise pour l’outil « {$toolLabel} ».\n"
                    .(string) ($pendingApproval['reason'] ?? '');
                $run->update([
                    'status' => 'awaiting_approval',
                    'summary' => mb_substr($summary, 0, 1000),
                    'finished_at' => now(),
                ]);
                $run->appendLog("Run en pause — approbation requise pour « {$toolLabel} ».");
                app(AgentRunCorrectionSummarizer::class)->finalize($run->fresh() ?? $run);
                $this->publishOverviewInterventionReport($agent, $run->fresh() ?? $run, $context);
                $agent->update(['status' => 'idle', 'last_run_at' => now()]);
                broadcast(new AgentRunUpdated($agent, $run->fresh() ?? $run, 'awaiting_approval'));

                return;
            }

            $run->update([
                'status' => 'completed',
                'summary' => mb_substr($summary, 0, 1000),
                'finished_at' => now(),
            ]);

            app(AgentRunCorrectionSummarizer::class)->finalize($run->fresh() ?? $run);
            app(ApplicationReadinessService::class)->handleAgentOutcome($run->fresh() ?? $run);
            $this->publishOverviewInterventionReport($agent, $run->fresh() ?? $run, $context);

            $agent->update(['status' => 'idle', 'last_run_at' => now()]);
            broadcast(new AgentRunUpdated($agent, $run->fresh() ?? $run, 'completed'));

        } catch (\Throwable $e) {
            $run->appendLog('Erreur: '.$e->getMessage());
            $run->update([
                'status' => 'failed',
                'summary' => 'Erreur: '.mb_substr($e->getMessage(), 0, 500),
                'finished_at' => now(),
            ]);
            app(AgentRunCorrectionSummarizer::class)->finalize($run->fresh() ?? $run);
            app(ApplicationReadinessService::class)->handleAgentOutcome($run->fresh() ?? $run);
            $this->publishOverviewInterventionReport($agent, $run->fresh() ?? $run, $context);
            $agent->update(['status' => 'error', 'last_run_at' => now()]);
            broadcast(new AgentRunUpdated($agent, $run->fresh() ?? $run, 'failed'));
        }
    }

    /**
     * @param  array<string, mixed>  $context
     */
    private function publishOverviewInterventionReport(AiAgent $agent, AiAgentRun $run, array $context): void
    {
        $event = $context['event'] ?? ($run->metadata['event'] ?? null);
        if (! in_array($event, ['deployment_failed', 'application_readiness_failed'], true)) {
            return;
        }

        try {
            app(ApplicationOverviewChatBridge::class)->postInterventionReport($agent, $run, $context);
        } catch (\Throwable $e) {
            $run->appendLog('Overview chat: publication rapport impossible — '.mb_substr($e->getMessage(), 0, 200));
        }
    }

    /**
     * Filet déterministe quand le LLM diagnostique sans corriger (logs lus, 0 correction_actions).
     *
     * @param  array<string, mixed>  $context
     */
    private function tryRepairHarnessFallback(
        AgentToolkit $toolkit,
        AiAgent $agent,
        AiAgentRun $run,
        array $context,
        string $goal,
        string $logMessage,
    ): ?string {
        if (! AgentChatRepairStrategy::shouldFallbackToHarness(
            is_string($context['event'] ?? null) ? $context['event'] : null,
            (bool) config('devforge.agents_auto_fallback', true),
            $this->harnessUsed,
            $run->metadata['correction_actions'] ?? null,
        )) {
            return null;
        }

        $this->harnessUsed = true;
        $this->anyToolUsed = true;
        $this->correctionNudgeUsed = true;

        $harness = app(AgentRepairHarness::class)->execute(
            $toolkit,
            $agent,
            $run,
            $context,
            $goal,
        );

        $run->appendLog($logMessage);

        if (isset($harness['pending_approval']) && is_array($harness['pending_approval'])) {
            $run->mergeMetadata(['pending_approval' => $harness['pending_approval']]);
        }

        return $harness['text'];
    }

    /**
     * @param  array<string, mixed>  $context
     */
    private function maybeAutoFixDeploymentInfrastructure(AgentToolkit $toolkit, AiAgentRun $run, array $context): void
    {
        $event = $context['event'] ?? null;
        if (! in_array($event, ['deployment_failed', 'application_readiness_failed'], true)) {
            return;
        }

        $excerpt = is_array($context['failure_excerpt'] ?? null) ? $context['failure_excerpt'] : [];
        if ($excerpt === [] && is_string($context['probe_error'] ?? null) && $context['probe_error'] !== '') {
            $excerpt = [['message' => (string) $context['probe_error']]];
        }

        $applicationUuid = is_string($context['application_uuid'] ?? null) ? $context['application_uuid'] : null;
        if ($applicationUuid === null || $applicationUuid === '') {
            return;
        }

        if (AgentDirectives::failureExcerptHasCoolifyBaseConfigPathIssue($excerpt)) {
            $run->appendLog('Read-only /data Coolify détecté — correction automatique (fix_coolify_base_config_path).');

            $result = $toolkit->execute('fix_coolify_base_config_path', [
                'application_uuid' => $applicationUuid,
                'redeploy' => true,
                'reason' => 'Auto-fix: Read-only /data Coolify path',
            ]);

            $this->recordAutoFixOutcome(
                $run,
                'fix_coolify_base_config_path',
                $result,
                'Auto-fix BASE_CONFIG_PATH OK',
            );

            return;
        }

        if (AgentDirectives::failureExcerptHasHostPermissionIssue($excerpt)) {
            $run->appendLog('Permission denied hôte détecté dans les logs — correction automatique (fix_application_host_permissions).');

            $result = $toolkit->execute('fix_application_host_permissions', [
                'application_uuid' => $applicationUuid,
                'redeploy' => true,
                'reason' => 'Auto-fix: Permission denied host (tee/.env)',
            ]);

            $this->recordAutoFixOutcome(
                $run,
                'fix_application_host_permissions',
                $result,
                'Auto-fix permissions OK',
            );

            return;
        }

        if (AgentDirectives::failureExcerptHasInvalidChownGroupIssue($excerpt)) {
            $run->appendLog('chown invalid group détecté — redéploiement automatique (groupe primaire).');

            $result = $toolkit->execute('control_resource', [
                'uuid' => $applicationUuid,
                'type' => 'applications',
                'action' => 'deploy',
                'reason' => 'Auto-fix: chown invalid group (user:primary group)',
            ]);

            $this->recordAutoFixOutcome(
                $run,
                'control_resource',
                $result,
                'Auto-fix chown group — redeploy lancé',
            );

            return;
        }

        if (AgentDirectives::failureExcerptHasReadinessPlatformCrash($excerpt)) {
            $run->appendLog('Crash plateforme readiness (ApplicationReadiness) — redéploiement automatique.');

            $result = $toolkit->execute('control_resource', [
                'uuid' => $applicationUuid,
                'type' => 'applications',
                'action' => 'deploy',
                'reason' => 'Auto-fix: rollback post-deploy dû à ApplicationReadiness manquant',
            ]);

            $this->recordAutoFixOutcome(
                $run,
                'control_resource',
                $result,
                'Auto-fix readiness crash — redeploy lancé',
            );

            return;
        }

        if ($this->shouldAutoFixStaticPublishDirectory($context, $excerpt, $applicationUuid)) {
            $publishDirectory = $this->resolveStaticPublishDirectory($toolkit, $run, $applicationUuid, $context, $excerpt);

            if ($publishDirectory === null || $publishDirectory === '') {
                $run->appendLog('Page nginx / publish_directory suspect — impossible de déduire le dossier (logs + source) ; laisse l’agent LLM investiguer.');

                return;
            }

            $currentPublish = AgentDirectives::normalizePublishDirectory(
                is_string($context['publish_directory'] ?? null) ? (string) $context['publish_directory'] : null,
            );
            if ($currentPublish === $publishDirectory) {
                $run->appendLog("publish_directory déjà à {$publishDirectory} malgré page nginx — pas d’auto-fix (cause probablement ailleurs).");

                return;
            }

            $run->appendLog("publish_directory manquant/incorrect pour site statique — correction automatique ({$publishDirectory}).");

            $settingsArgs = [
                'application_uuid' => $applicationUuid,
                'publish_directory' => $publishDirectory,
                'redeploy' => true,
                'reason' => "Auto-fix: publish_directory={$publishDirectory} (déduit logs/source)",
            ];
            // Never flip a Node/SSR (nixpacks) app to static — only reinforce an already-static site.
            if ($this->contextIndicatesStaticSite($context, $applicationUuid)) {
                $settingsArgs['is_static'] = true;
            }

            $result = $toolkit->execute('update_application_runtime_settings', $settingsArgs);

            $this->recordAutoFixOutcome(
                $run,
                'update_application_runtime_settings',
                $result,
                "Auto-fix publish_directory={$publishDirectory} OK",
            );
        }
    }

    /**
     * @param  array<string, mixed>  $context
     * @param  array<int, mixed>  $excerpt
     */
    private function resolveStaticPublishDirectory(
        AgentToolkit $toolkit,
        AiAgentRun $run,
        string $applicationUuid,
        array $context,
        array $excerpt,
    ): ?string {
        $publishDirectory = AgentDirectives::inferStaticPublishDirectory(
            $excerpt,
            is_string($context['probe_error'] ?? null) ? (string) $context['probe_error'] : null,
        );
        if ($publishDirectory !== null) {
            return $publishDirectory;
        }

        $run->appendLog('publish_directory : lecture des logs de déploiement pour déduire le dossier…');
        $logsResult = $toolkit->execute('get_deployment_logs', [
            'application_uuid' => $applicationUuid,
            'limit' => 2,
            'log_lines' => 200,
        ]);
        $logsExcerpt = [['message' => json_encode($logsResult, JSON_UNESCAPED_UNICODE) ?: '']];
        $publishDirectory = AgentDirectives::inferStaticPublishDirectory($logsExcerpt);
        if ($publishDirectory !== null) {
            $run->appendLog("publish_directory déduit des logs : {$publishDirectory}");

            return $publishDirectory;
        }

        $run->appendLog('publish_directory : inspection du dépôt source (dist/build/out/…)…');
        $sourceResult = $toolkit->execute('list_application_source', [
            'application_uuid' => $applicationUuid,
            'path' => '/',
        ]);
        $publishDirectory = AgentDirectives::pickStaticPublishDirectoryFromSourceEntries(
            is_array($sourceResult['entries'] ?? null) ? $sourceResult['entries'] : [],
        );
        if ($publishDirectory !== null) {
            $run->appendLog("publish_directory déduit du dépôt : {$publishDirectory}");

            return $publishDirectory;
        }

        // Nested Next/Nuxt style outputs
        foreach (['.output', 'dist'] as $nestedRoot) {
            $nested = $toolkit->execute('list_application_source', [
                'application_uuid' => $applicationUuid,
                'path' => '/'.$nestedRoot,
            ]);
            if (isset($nested['error'])) {
                continue;
            }
            $names = collect(is_array($nested['entries'] ?? null) ? $nested['entries'] : [])
                ->filter(fn ($entry): bool => is_array($entry) && in_array(($entry['type'] ?? ''), ['directory', 'dir'], true))
                ->map(fn (array $entry): string => strtolower((string) ($entry['name'] ?? '')))
                ->filter()
                ->values();
            if ($nestedRoot === '.output' && $names->contains('public')) {
                return '/.output/public';
            }
            if ($nestedRoot === 'dist' && $names->contains('client')) {
                return '/dist/client';
            }
        }

        // Dernier recours : exemple cité dans le message probe (« ex. /dist manquant »).
        $probeHint = is_string($context['probe_error'] ?? null) ? (string) $context['probe_error'] : '';
        if (
            $probeHint !== ''
            && preg_match('/publish_directory probablement incorrect[^\n]*\b(\/[A-Za-z0-9._-]+)\b/iu', $probeHint, $m) === 1
        ) {
            $fallback = AgentDirectives::normalizePublishDirectory($m[1]);
            if ($fallback !== null) {
                $run->appendLog("publish_directory fallback depuis message probe : {$fallback}");

                return $fallback;
            }
        }

        return null;
    }

    /**
     * @param  array<string, mixed>  $context
     * @param  array<int, mixed>  $excerpt
     */
    private function shouldAutoFixStaticPublishDirectory(array $context, array $excerpt, string $applicationUuid): bool
    {
        // nixpacks/railpack ≠ static: only auto-fix publish_directory for genuine static sites.
        if (! $this->contextIndicatesStaticSite($context, $applicationUuid)) {
            return false;
        }

        $publishDirectory = trim((string) ($context['publish_directory'] ?? ''));
        $isEmptyPublish = $publishDirectory === '' || $publishDirectory === '/' || strtolower($publishDirectory) === 'null';

        if (AgentDirectives::failureExcerptHasMissingStaticPublishDirectoryIssue($excerpt)) {
            return true;
        }

        if (($context['event'] ?? null) === 'application_readiness_failed' && $isEmptyPublish) {
            return true;
        }

        $probeError = is_string($context['probe_error'] ?? null) ? (string) $context['probe_error'] : '';
        if (
            ($context['event'] ?? null) === 'application_readiness_failed'
            && AgentDirectives::isMissingStaticPublishDirectoryIssue($probeError)
        ) {
            return true;
        }

        if ($isEmptyPublish && AgentDirectives::failureExcerptHasMissingStaticPublishDirectoryIssue([
            ...$excerpt,
            ['message' => (string) ($context['probe_error'] ?? '')],
        ])) {
            return true;
        }

        // Build logs mention a publishable output dir while publish_directory is empty.
        return $isEmptyPublish && AgentDirectives::inferStaticPublishDirectory($excerpt) !== null;
    }

    /**
     * @param  array<string, mixed>  $context
     */
    private function contextIndicatesStaticSite(array $context, string $applicationUuid): bool
    {
        if (array_key_exists('is_static', $context)) {
            if (filter_var($context['is_static'], FILTER_VALIDATE_BOOLEAN)) {
                return true;
            }

            // Explicit non-static in context: never treat nixpacks/railpack as static.
            return strtolower((string) ($context['build_pack'] ?? '')) === 'static';
        }

        if (strtolower((string) ($context['build_pack'] ?? '')) === 'static') {
            return true;
        }

        $application = \App\Models\Application::query()->where('uuid', $applicationUuid)->first();
        if ($application === null) {
            return false;
        }

        if ((bool) ($application->settings?->is_static ?? false)) {
            return true;
        }

        return strtolower((string) $application->build_pack) === 'static';
    }

    /**
     * Issues où le LLM n’apporte rien (secret manquant, etc.) — harness immédiat.
     *
     * @param  array<string, mixed>  $context
     * @return array{text: string, steps: list<array<string, mixed>>, pending_approval?: array<string, mixed>}|null
     */
    private function maybeRunEarlyDeterministicHarness(
        AgentToolkit $toolkit,
        AiAgent $agent,
        AiAgentRun $run,
        array $context,
    ): ?array {
        $event = $context['event'] ?? null;
        if (! in_array($event, ['deployment_failed', 'application_readiness_failed'], true)) {
            return null;
        }

        $excerpt = is_array($context['failure_excerpt'] ?? null) ? $context['failure_excerpt'] : [];
        if ($excerpt === [] && is_string($context['probe_error'] ?? null) && $context['probe_error'] !== '') {
            $excerpt = [['message' => (string) $context['probe_error']]];
        }

        if (
            $event === 'deployment_failed'
            && AgentDirectives::failureExcerptHasNpmPrivateRegistryAuthIssue($excerpt)
        ) {
            $run->appendLog('npm E401 registry privé détecté — harness déterministe avant LLM (GitHub App / needs_user).');

            $this->anyToolUsed = true;
            $this->correctionNudgeUsed = true;

            return app(AgentRepairHarness::class)->execute(
                $toolkit,
                $agent,
                $run,
                $context,
                'Auth npm registry privé manquante',
            );
        }

        if (
            AgentDirectives::failureExcerptHasMissingStaticPublishDirectoryIssue($excerpt)
            || AgentDirectives::isMissingStaticPublishDirectoryIssue(
                is_string($context['probe_error'] ?? null) ? (string) $context['probe_error'] : null,
            )
        ) {
            // maybeAutoFix a déjà tenté ; si on arrive ici sans correction, le harness nginx sert de filet.
            if ($this->anyToolUsed) {
                return null;
            }

            $run->appendLog('Page nginx / publish_directory — harness déterministe avant LLM.');

            $this->anyToolUsed = true;
            $this->correctionNudgeUsed = true;

            return app(AgentRepairHarness::class)->execute(
                $toolkit,
                $agent,
                $run,
                $context,
                'Corriger publish_directory (page nginx)',
            );
        }

        return null;
    }

    /**
     * @param  array<string, mixed>  $result
     */
    private function recordAutoFixOutcome(AiAgentRun $run, string $tool, array $result, string $successLog): void
    {
        $this->anyToolUsed = true;
        $this->correctionNudgeUsed = true;

        $payload = json_encode($result, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: '{}';
        $this->messages[] = [
            'role' => 'user',
            'content' => "Correction automatique déjà exécutée ({$tool}). "
                ."Résultat: {$payload}. "
                .'Ne recrée PAS de variable factice. Si ok+redeploy, résume brièvement ; sinon diagnostique l’échec du fix.',
        ];

        if (isset($result['error'])) {
            $run->appendLog('Auto-fix échoué: '.mb_substr((string) $result['error'], 0, 300));

            return;
        }

        $run->appendLog($successLog.(isset($result['redeploy']) ? ' + redeploy lancé' : ''));
    }
}
