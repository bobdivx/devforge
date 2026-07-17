<?php

namespace App\Services\DevForge\Agent;

use App\Enums\TaskModelTier;
use App\Events\AgentRunUpdated;
use App\Models\AiAgent;
use App\Models\AiAgentRun;
use App\Services\DevForge\Agent\Contracts\LlmResponse;
use App\Services\DevForge\Agent\Tool\AgentSubagentRegistry;
use App\Services\DevForge\Agent\Tool\IterationBudget;
use App\Services\DevForge\Core\CoreResourceAction;
use App\Services\DevForge\Core\CoreResourceCatalog;
use App\Services\DevForge\DeploymentData;

class AgentRunner
{
    /** @var array<array{role: string, content: string}> */
    private array $messages = [];

    private bool $toolNudgeUsed = false;

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
                    if ($iterations === 1 && ! $this->toolNudgeUsed) {
                        $this->toolNudgeUsed = true;
                        $this->messages[] = ['role' => 'assistant', 'content' => $response->text ?: 'En attente d\'action.'];
                        $this->messages[] = ['role' => 'user', 'content' => AgentDirectives::toolNudgeMessage()];
                        $run->appendLog('Relance autonome : premier tour sans outil — nouvelle consigne envoyée.');

                        continue;
                    }

                    $run->appendLog('Agent terminé — aucun appel d\'outil supplémentaire.');
                    break;
                }

                $toolResults = [];
                $hadToolFailure = false;
                foreach ($response->toolCalls as $toolCall) {
                    $result = $toolkit->execute($toolCall['name'], $toolCall['arguments']);
                    if (isset($result['error'])) {
                        $hadToolFailure = true;
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
            }

            if ($budget->getRemaining() === 0) {
                $run->appendLog('Limite d\'itérations atteinte.');
                $summary = $summary ?: 'Limite d\'itérations atteinte sans conclusion.';
            }

            $run->update([
                'status' => 'completed',
                'summary' => mb_substr($summary, 0, 1000),
                'finished_at' => now(),
            ]);

            app(AgentRunCorrectionSummarizer::class)->finalize($run->fresh() ?? $run);

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
            $agent->update(['status' => 'error', 'last_run_at' => now()]);
            broadcast(new AgentRunUpdated($agent, $run->fresh() ?? $run, 'failed'));
        }
    }
}
