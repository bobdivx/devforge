<?php

namespace App\Services\DevForge\Agent;

use App\Models\AiAgent;
use App\Models\AiAgentKeyRequest;
use App\Models\AiAgentRun;
use App\Models\Application;
use App\Services\DevForge\Application\ApplicationGitRepositoryParser;
use App\Services\DevForge\Application\GithubPackagesBuildAuthInjector;
use App\Services\DevForge\Application\NixpacksNodeVersionApplier;
use App\Services\DevForge\Application\NixpacksNodeVersionResolver;
use Illuminate\Support\Facades\Schema;

/**
 * Séquence de réparation déterministe quand le LLM refuse d'émettre des tool_calls.
 */
class AgentRepairHarness
{
    /**
     * @param  array<string, mixed>  $runContext
     * @return array{
     *     text: string,
     *     steps: list<array<string, mixed>>,
     *     pending_approval?: array<string, mixed>
     * }
     */
    public function execute(
        AgentToolkit $toolkit,
        AiAgent $agent,
        AiAgentRun $run,
        array $runContext,
        string $goal = '',
    ): array {
        if (! config('devforge.agents_auto_fallback', true)) {
            return [
                'text' => 'Fallback automatique désactivé (DEVFORGE_AGENTS_AUTO_FALLBACK).',
                'steps' => [],
            ];
        }

        $applicationUuid = is_string($runContext['application_uuid'] ?? null) && $runContext['application_uuid'] !== ''
            ? $runContext['application_uuid']
            : (is_string($agent->resource_uuid) && $agent->resource_uuid !== '' ? $agent->resource_uuid : null);

        $appArgs = [];
        if ($applicationUuid !== null) {
            $appArgs['application_uuid'] = $applicationUuid;
        }

        $steps = [];
        $pendingApproval = null;

        $record = function (string $name, array $arguments, array $result) use (&$steps, &$pendingApproval): void {
            if (($result['status'] ?? null) === 'ask' || ! empty($result['pending_approval'])) {
                $pendingApproval = [
                    'status' => 'ask',
                    'tool' => (string) ($result['tool'] ?? $name),
                    'reason' => (string) ($result['reason'] ?? 'Approbation requise.'),
                    'rule_id' => (string) ($result['rule_id'] ?? ''),
                    'approval_key' => (string) ($result['approval_key'] ?? ''),
                ];
            }

            $steps[] = [
                'type' => 'tool',
                'name' => $name,
                'args_summary' => $this->summarizeToolArgs($arguments),
                'result_summary' => $this->summarizeToolResult($result),
                'status' => isset($result['error'])
                    ? 'error'
                    : (($result['status'] ?? null) === 'ask' || ! empty($result['pending_approval']) ? 'awaiting_approval' : 'done'),
            ];
        };

        $run->appendLog('Harness réparation : exécution déterministe forcée.');

        $logsArgs = [...$appArgs, 'limit' => 3, 'log_lines' => 120];
        $logsResult = $toolkit->execute('get_deployment_logs', $logsArgs);
        $record('get_deployment_logs', $logsArgs, $logsResult);

        $logsBlob = mb_strtolower(json_encode($logsResult, JSON_UNESCAPED_UNICODE) ?: '');
        if ($logsBlob === '' || $logsBlob === '[]' || $logsBlob === 'null' || $logsBlob === '{}') {
            $excerpt = is_array($runContext['failure_excerpt'] ?? null) ? $runContext['failure_excerpt'] : [];
            $probe = is_string($runContext['probe_error'] ?? null) ? (string) $runContext['probe_error'] : '';
            $logsBlob = mb_strtolower(json_encode([
                'failure_excerpt' => $excerpt,
                'probe_error' => $probe,
            ], JSON_UNESCAPED_UNICODE) ?: '');
        }

        // Inclure le goal chat + erreurs probe du contexte (page nginx souvent hors logs build).
        $probeHint = is_string($runContext['probe_error'] ?? null) ? (string) $runContext['probe_error'] : '';
        $lastProbe = is_string($runContext['last_probe_error'] ?? null) ? (string) $runContext['last_probe_error'] : '';
        $issueBlob = trim($logsBlob.' '.$goal.' '.$probeHint.' '.$lastProbe);
        $issue = AgentChatRepairStrategy::detectIssue($issueBlob);

        if ($issue === AgentChatRepairStrategy::ISSUE_BASE_CONFIG) {
            $fixArgs = [...$appArgs, 'redeploy' => true, 'reason' => 'Harness: Read-only DevForge BASE_CONFIG_PATH'];
            $fixResult = $toolkit->execute('fix_coolify_base_config_path', $fixArgs);
            $record('fix_coolify_base_config_path', $fixArgs, $fixResult);
        } elseif ($issue === AgentChatRepairStrategy::ISSUE_HEALTHCHECK_PORT) {
            $listenPort = AgentDirectives::inferListenPortFromLogs($issueBlob)
                ?? AgentDirectives::inferListenPortFromLogs($logsBlob);
            $healthPort = AgentDirectives::inferHealthcheckPortFromLogs($issueBlob)
                ?? AgentDirectives::inferHealthcheckPortFromLogs($logsBlob);

            $targetPort = $listenPort ?? $healthPort;
            // Prefer the port the process actually binds to.
            if ($listenPort !== null) {
                $targetPort = $listenPort;
            }

            if ($targetPort !== null && $applicationUuid !== null) {
                $settingsArgs = [
                    ...$appArgs,
                    'ports_exposes' => $targetPort,
                    'health_check_port' => $targetPort,
                    'is_static' => false,
                    'redeploy' => true,
                    'reason' => "Harness: healthcheck port mismatch → ports/health={$targetPort}"
                        .($healthPort !== null && $listenPort !== null ? " (était health={$healthPort}, listen={$listenPort})" : ''),
                ];
                $settingsResult = $toolkit->execute('update_application_runtime_settings', $settingsArgs);
                $record('update_application_runtime_settings', $settingsArgs, $settingsResult);

                $envArgs = [
                    ...$appArgs,
                    'key' => 'PORT',
                    'value' => $targetPort,
                    'is_buildtime' => false,
                    'is_runtime' => true,
                ];
                $envResult = $toolkit->execute('upsert_application_env_var', $envArgs);
                $record('upsert_application_env_var', $envArgs, $envResult);

                // Ensure Traefik labels follow the corrected port (not stale port=80).
                $syncArgs = [
                    ...$appArgs,
                    'redeploy' => false,
                    'reason' => "Harness: sync labels après healthcheck → {$targetPort}",
                ];
                $syncResult = $toolkit->execute('sync_application_proxy_labels', $syncArgs);
                $record('sync_application_proxy_labels', $syncArgs, $syncResult);

                $headline = "Port aligné sur {$targetPort} (healthcheck + ports_exposes + PORT) — redeploy lancé.";
                $action = [
                    'kind' => 'runtime_settings',
                    'label' => 'healthcheck_port',
                    'detail' => $targetPort,
                    'ok' => ! isset($settingsResult['error']),
                    'at' => now()->toISOString(),
                ];
                $run->mergeMetadata([
                    'correction_actions' => [
                        ...((is_array($run->metadata['correction_actions'] ?? null)) ? $run->metadata['correction_actions'] : []),
                        $action,
                    ],
                    'correction' => [
                        'outcome' => isset($settingsResult['error']) ? 'partial' : 'fixed',
                        'headline' => $headline,
                        'diagnosis' => 'Healthcheck sur un port différent de celui où l’application écoute (ex. curl :3000 vs Astro :4321).',
                        'source_scope' => 'runtime_settings',
                        'actions' => [$action],
                        'steps' => [
                            "ports_exposes={$targetPort}",
                            "health_check_port={$targetPort}",
                            "PORT={$targetPort}",
                            'Redéployer',
                        ],
                        'pills' => [
                            ['id' => 'build', 'label' => 'Ports', 'active' => true, 'href' => null, 'detail' => ":{$targetPort}"],
                            ['id' => 'redeploy', 'label' => 'Redeploy', 'active' => true, 'href' => null, 'detail' => 'lancé'],
                        ],
                        'belongs_to_deployment_uuid' => is_string($runContext['deployment_uuid'] ?? null)
                            ? $runContext['deployment_uuid']
                            : null,
                    ],
                ]);

                return [
                    'text' => $headline,
                    'steps' => $steps,
                ];
            }

            $headline = 'Healthcheck unhealthy — impossible de déduire le port d’écoute depuis les logs.';
            $run->mergeMetadata([
                'correction_actions' => [
                    ...((is_array($run->metadata['correction_actions'] ?? null)) ? $run->metadata['correction_actions'] : []),
                    [
                        'kind' => 'needs_user',
                        'label' => 'healthcheck_port',
                        'detail' => $headline,
                        'ok' => false,
                        'at' => now()->toISOString(),
                    ],
                ],
            ]);

                return [
                    'text' => $headline."\n\nVérifiez ports_exposes / health_check_port / variable PORT (Astro SSR → souvent 4321).",
                    'steps' => $steps,
                ];
        } elseif ($issue === AgentChatRepairStrategy::ISSUE_PROXY_PORT) {
            $listenPort = AgentDirectives::inferListenPortFromLogs($issueBlob)
                ?? AgentDirectives::inferListenPortFromLogs($logsBlob);

            $application = $applicationUuid !== null
                ? Application::query()->where('uuid', $applicationUuid)->first()
                : null;
            $currentPorts = trim((string) ($application?->ports_exposes ?? ''));
            $targetPort = $listenPort
                ?? ($currentPorts !== '' && $currentPorts !== '80' ? $currentPorts : null)
                ?? '4321';

            if ($applicationUuid !== null) {
                if ((string) $currentPorts !== (string) $targetPort) {
                    $settingsArgs = [
                        ...$appArgs,
                        'ports_exposes' => $targetPort,
                        'health_check_port' => $targetPort,
                        'is_static' => false,
                        'redeploy' => false,
                        'reason' => "Harness: 502 proxy → ports_exposes={$targetPort}",
                    ];
                    $settingsResult = $toolkit->execute('update_application_runtime_settings', $settingsArgs);
                    $record('update_application_runtime_settings', $settingsArgs, $settingsResult);
                }

                $syncArgs = [
                    ...$appArgs,
                    'redeploy' => true,
                    'reason' => "Harness: 502 — sync Traefik labels → port {$targetPort}",
                ];
                $syncResult = $toolkit->execute('sync_application_proxy_labels', $syncArgs);
                $record('sync_application_proxy_labels', $syncArgs, $syncResult);

                $headline = "Labels proxy alignés sur le port {$targetPort} (502 Bad Gateway) — redeploy lancé.";
                $action = [
                    'kind' => 'proxy_labels',
                    'label' => 'sync_proxy_labels',
                    'detail' => "port={$targetPort}",
                    'ok' => ! isset($syncResult['error']),
                    'at' => now()->toISOString(),
                ];
                $run->mergeMetadata([
                    'correction_actions' => [
                        ...((is_array($run->metadata['correction_actions'] ?? null)) ? $run->metadata['correction_actions'] : []),
                        $action,
                    ],
                    'correction' => [
                        'outcome' => isset($syncResult['error']) ? 'partial' : 'fixed',
                        'headline' => $headline,
                        'diagnosis' => 'Traefik loadbalancer.server.port désynchronisé de ports_exposes (souvent 80 vs 4321) → Cloudflare 502.',
                        'source_scope' => 'proxy_labels',
                        'actions' => [$action],
                        'steps' => [
                            "ports_exposes={$targetPort}",
                            'Régénérer custom_labels Traefik',
                            'Redéployer',
                        ],
                        'pills' => [
                            ['id' => 'proxy', 'label' => 'Proxy', 'active' => true, 'href' => null, 'detail' => ":{$targetPort}"],
                            ['id' => 'redeploy', 'label' => 'Redeploy', 'active' => true, 'href' => null, 'detail' => 'lancé'],
                        ],
                        'belongs_to_deployment_uuid' => is_string($runContext['deployment_uuid'] ?? null)
                            ? $runContext['deployment_uuid']
                            : null,
                    ],
                ]);

                return [
                    'text' => $headline,
                    'steps' => $steps,
                ];
            }

            return [
                'text' => '502 Bad Gateway — impossible d’aligner les labels proxy sans UUID application.',
                'steps' => $steps,
            ];
        } elseif ($issue === AgentChatRepairStrategy::ISSUE_PERMISSIONS) {
            $fixArgs = [...$appArgs, 'redeploy' => true, 'reason' => 'Harness: Permission denied host'];
            $fixResult = $toolkit->execute('fix_application_host_permissions', $fixArgs);
            $record('fix_application_host_permissions', $fixArgs, $fixResult);
        } elseif ($issue === AgentChatRepairStrategy::ISSUE_PUPPETEER) {
            $settingsArgs = [
                ...$appArgs,
                'skip_puppeteer_browser_download' => true,
                'redeploy' => true,
                'reason' => 'Harness: Puppeteer — activer le skip Chrome (paramètre avancé)',
            ];
            $settingsResult = $toolkit->execute('update_application_advanced_settings', $settingsArgs);
            $record('update_application_advanced_settings', $settingsArgs, $settingsResult);
        } elseif ($issue === AgentChatRepairStrategy::ISSUE_NODE_ENGINE) {
            $application = $applicationUuid !== null
                ? Application::query()->where('uuid', $applicationUuid)->first()
                : null;
            $applier = app(NixpacksNodeVersionApplier::class);
            $resolver = app(NixpacksNodeVersionResolver::class);
            $current = $application instanceof Application
                ? ($applier->current($application) ?? NixpacksNodeVersionResolver::DEFAULT)
                : NixpacksNodeVersionResolver::DEFAULT;
            $next = $resolver->resolveFromBuildError($issueBlob, $current);

            if ($next !== null && $applicationUuid !== null) {
                $envKey = $application instanceof Application ? $applier->keyFor($application) : 'NIXPACKS_NODE_VERSION';
                $envArgs = [
                    ...$appArgs,
                    'key' => $envKey,
                    'value' => $next,
                    'is_buildtime' => true,
                    'is_runtime' => false,
                    'is_literal' => true,
                ];
                $envResult = $toolkit->execute('upsert_application_env_var', $envArgs);
                $record('upsert_application_env_var', $envArgs, $envResult);

                $deployArgs = [
                    'uuid' => $applicationUuid,
                    'type' => 'applications',
                    'action' => 'deploy',
                    'reason' => "Harness: {$envKey} {$current} → {$next}",
                ];
                $deployResult = $toolkit->execute('control_resource', $deployArgs);
                $record('control_resource', $deployArgs, $deployResult);
            }
        } elseif ($issue === AgentChatRepairStrategy::ISSUE_BRANCH) {
            $gitResult = $toolkit->execute('get_application_git_info', $appArgs);
            $record('get_application_git_info', $appArgs, $gitResult);

            $parsedRepo = ApplicationGitRepositoryParser::parseOwnerRepo(
                is_string($gitResult['git_repository'] ?? null) ? $gitResult['git_repository'] : null,
            );
            $githubAppUuid = is_string($gitResult['github_app_uuid'] ?? null) ? $gitResult['github_app_uuid'] : null;

            if ($githubAppUuid !== null && $parsedRepo !== null) {
                $branchesArgs = [
                    'github_app_uuid' => $githubAppUuid,
                    'owner' => $parsedRepo['owner'],
                    'repo' => $parsedRepo['repo'],
                ];
                $branchesResult = $toolkit->execute('list_github_branches', $branchesArgs);
                $record('list_github_branches', $branchesArgs, $branchesResult);

                $branchNames = collect($branchesResult['branches'] ?? [])
                    ->map(fn ($branch): string => is_array($branch)
                        ? (string) ($branch['name'] ?? '')
                        : (string) $branch)
                    ->filter()
                    ->values();

                $current = (string) ($gitResult['git_branch'] ?? '');
                $preferred = $branchNames->first(fn (string $name): bool => $name !== $current && ! in_array($name, ['main', 'master'], true))
                    ?? $branchNames->first(fn (string $name): bool => $name !== $current);

                if (is_string($preferred) && $preferred !== '') {
                    $branchArgs = [...$appArgs, 'git_branch' => $preferred, 'redeploy' => true, 'reason' => 'Harness: branche introuvable'];
                    $branchResult = $toolkit->execute('update_application_git_branch', $branchArgs);
                    $record('update_application_git_branch', $branchArgs, $branchResult);
                }
            }
        } elseif ($issue === AgentChatRepairStrategy::ISSUE_NPM_AUTH) {
            $envResult = $toolkit->execute('list_application_env_vars', $appArgs);
            $record('list_application_env_vars', $appArgs, $envResult);

            $application = $applicationUuid !== null
                ? Application::query()->where('uuid', $applicationUuid)->first()
                : null;

            $diagnosis = $application !== null
                ? app(GithubPackagesBuildAuthInjector::class)->diagnose($application)
                : [
                    'ok' => false,
                    'can_auto_redeploy' => false,
                    'has_github_app' => false,
                    'has_packages_permission' => false,
                    'error' => 'Application introuvable pour diagnostiquer l’auth npm.',
                    'steps' => ['Vérifier l’UUID application puis ajouter NODE_AUTH_TOKEN (build).'],
                ];

            if (($diagnosis['can_auto_redeploy'] ?? false) === true && $applicationUuid !== null) {
                $deployArgs = [
                    'uuid' => $applicationUuid,
                    'type' => 'applications',
                    'action' => 'deploy',
                    'reason' => 'Harness: npm E401 — redeploy avec injection NODE_AUTH_TOKEN GitHub App',
                ];
                $deployResult = $toolkit->execute('control_resource', $deployArgs);
                $record('control_resource', $deployArgs, $deployResult);

                $headline = 'Auth npm GitHub Packages : redéploiement lancé (token GitHub App injecté au build).';
                $action = [
                    'kind' => 'redeploy',
                    'label' => 'Redeploy npm auth',
                    'detail' => $headline,
                    'ok' => ! isset($deployResult['error']),
                    'at' => now()->toISOString(),
                ];

                $run->mergeMetadata([
                    'correction_actions' => [
                        ...((is_array($run->metadata['correction_actions'] ?? null)) ? $run->metadata['correction_actions'] : []),
                        $action,
                    ],
                    'correction' => [
                        'outcome' => isset($deployResult['error']) ? 'partial' : 'fixed',
                        'headline' => $headline,
                        'diagnosis' => 'E401 npm.pkg.github.com — token d’installation GitHub App (packages:read) injecté au build.',
                        'source_scope' => 'env',
                        'actions' => [$action],
                        'steps' => $diagnosis['steps'] ?? [],
                        'pills' => [
                            ['id' => 'env', 'label' => 'Env DevForge', 'active' => true, 'href' => null, 'detail' => 'NODE_AUTH_TOKEN (GitHub App)'],
                            ['id' => 'redeploy', 'label' => 'Redeploy', 'active' => true, 'href' => null, 'detail' => 'lancé'],
                        ],
                        'belongs_to_deployment_uuid' => is_string($runContext['deployment_uuid'] ?? null)
                            ? $runContext['deployment_uuid']
                            : null,
                    ],
                ]);

                return [
                    'text' => $headline,
                    'steps' => $steps,
                ];
            }

            $headline = ($diagnosis['has_packages_token'] ?? false)
                ? 'Auth npm : token Packages présent — relancez le déploiement.'
                : 'Action requise : enregistrer un token Packages (DevForge → Connexions)';
            $stepsText = is_array($diagnosis['steps'] ?? null) ? $diagnosis['steps'] : [];
            $diagnosisText = 'npm E401 sur registry privé (npm.pkg.github.com). '.(($diagnosis['has_packages_token'] ?? false)
                ? 'PAT Packages déjà enregistré — un redeploy devrait injecter NODE_AUTH_TOKEN.'
                : (($diagnosis['has_github_app'] ?? false)
                    ? 'Créez un PAT GitHub (read:packages), enregistrez-le dans Connexions, puis relancez le déploiement. DevForge injecte NODE_AUTH_TOKEN au build.'
                    : 'Un secret d’auth est requis — l’agent ne peut pas l’inventer.'));

            $needsUserAction = [
                'kind' => 'needs_user',
                'label' => 'Auth npm registry',
                'detail' => $headline,
                'ok' => false,
                'at' => now()->toISOString(),
            ];

            $keyRequestUuid = $this->queueUserTokenRequest(
                $agent,
                $run,
                'GITHUB_PACKAGES_TOKEN',
                'token',
                'Token GitHub Packages (read:packages) requis pour npm.pkg.github.com (E401). '
                    .'Fournis un PAT ou enregistre-le dans Connexions — la valeur n’est pas renvoyée au modèle.',
                $applicationUuid,
            );

            $run->mergeMetadata([
                'correction_actions' => [
                    ...((is_array($run->metadata['correction_actions'] ?? null)) ? $run->metadata['correction_actions'] : []),
                    $needsUserAction,
                ],
                'correction' => [
                    'outcome' => 'needs_user',
                    'headline' => $headline,
                    'diagnosis' => $diagnosisText,
                    'source_scope' => 'env',
                    'actions' => [$needsUserAction],
                    'steps' => $stepsText,
                    'user_request_uuid' => $keyRequestUuid,
                    'pills' => [
                        [
                            'id' => 'connexions',
                            'label' => 'Ouvrir Connexions',
                            'active' => true,
                            'href' => '/connexions',
                            'detail' => 'token Packages',
                        ],
                        [
                            'id' => 'agents_inbox',
                            'label' => 'Inbox agents',
                            'active' => true,
                            'href' => '/devforge/agents',
                            'detail' => 'fournir token',
                        ],
                        [
                            'id' => 'build',
                            'label' => 'Build',
                            'active' => true,
                            'href' => null,
                            'detail' => 'npm E401',
                        ],
                    ],
                    'belongs_to_deployment_uuid' => is_string($runContext['deployment_uuid'] ?? null)
                        ? $runContext['deployment_uuid']
                        : null,
                ],
            ]);

            $run->update([
                'status' => 'waiting_for_input',
                'summary' => mb_substr($headline, 0, 1000),
                'finished_at' => now(),
            ]);
            $agent->update(['status' => 'idle', 'last_run_at' => now()]);

            $text = $headline."\n\n".collect($stepsText)
                ->values()
                ->map(fn (string $step, int $index): string => ($index + 1).'. '.$step)
                ->implode("\n");

            return [
                'text' => $text,
                'steps' => $steps,
            ];
        } elseif ($issue === AgentChatRepairStrategy::ISSUE_NGINX_PUBLISH) {
            $application = $applicationUuid !== null
                ? \App\Models\Application::query()->where('uuid', $applicationUuid)->first()
                : null;
            $alreadyStatic = (bool) ($application?->settings?->is_static ?? false)
                || strtolower((string) ($application?->build_pack ?? '')) === 'static';
            $portsExposes = trim((string) ($application?->ports_exposes ?? ''));
            $framework = mb_strtolower((string) ($application?->detected_framework ?? ''));
            $looksLikeSsr = str_contains($framework, 'ssr')
                || (
                    ! $alreadyStatic && (
                        str_contains($framework, 'astro')
                        || in_array($portsExposes, ['4321', '3000', '3001', '8080'], true)
                        || filled($application?->start_command)
                    )
                );

            // Astro/Node SSR servi comme nginx stock → forcer runtime Node, pas publish_directory.
            if ($looksLikeSsr && $applicationUuid !== null) {
                $port = $portsExposes !== '' ? $portsExposes : '4321';
                $settingsArgs = [
                    ...$appArgs,
                    'is_static' => false,
                    'ports_exposes' => $port,
                    'publish_directory' => '/',
                    'redeploy' => true,
                    'reason' => "Harness: page nginx sur app SSR → is_static=false ports={$port}",
                ];
                $settingsResult = $toolkit->execute('update_application_runtime_settings', $settingsArgs);
                $record('update_application_runtime_settings', $settingsArgs, $settingsResult);

                $headline = "Runtime SSR rétabli (is_static=false, port {$port}) — page nginx ne doit plus être servie.";
                $action = [
                    'kind' => 'runtime_settings',
                    'label' => 'ssr_runtime',
                    'detail' => "ports_exposes={$port}",
                    'ok' => ! isset($settingsResult['error']),
                    'at' => now()->toISOString(),
                ];
                $run->mergeMetadata([
                    'correction_actions' => [
                        ...((is_array($run->metadata['correction_actions'] ?? null)) ? $run->metadata['correction_actions'] : []),
                        $action,
                    ],
                    'correction' => [
                        'outcome' => isset($settingsResult['error']) ? 'partial' : 'fixed',
                        'headline' => $headline,
                        'diagnosis' => 'Page nginx stock sur une app SSR — le conteneur Node doit écouter le port exposé (pas nginx static).',
                        'source_scope' => 'runtime_settings',
                        'actions' => [$action],
                        'steps' => ["is_static=false", "ports_exposes={$port}", 'Redéployer'],
                        'pills' => [
                            ['id' => 'build', 'label' => 'Build', 'active' => true, 'href' => null, 'detail' => "SSR :{$port}"],
                            ['id' => 'redeploy', 'label' => 'Redeploy', 'active' => true, 'href' => null, 'detail' => 'lancé'],
                        ],
                        'belongs_to_deployment_uuid' => is_string($runContext['deployment_uuid'] ?? null)
                            ? $runContext['deployment_uuid']
                            : null,
                    ],
                ]);

                return [
                    'text' => $headline,
                    'steps' => $steps,
                ];
            }

            $publishDirectory = AgentDirectives::inferStaticPublishDirectory([
                ['message' => $issueBlob !== '' ? $issueBlob : $logsBlob],
            ]);

            if ($publishDirectory === null && $applicationUuid !== null) {
                $sourceArgs = [...$appArgs, 'path' => '/'];
                $sourceResult = $toolkit->execute('list_application_source', $sourceArgs);
                $record('list_application_source', $sourceArgs, $sourceResult);
                $publishDirectory = AgentDirectives::pickStaticPublishDirectoryFromSourceEntries(
                    is_array($sourceResult['entries'] ?? null) ? $sourceResult['entries'] : [],
                );
            }

            if ($publishDirectory === null && preg_match('/ex\.\s*(\/[A-Za-z0-9._-]+)/iu', $issueBlob !== '' ? $issueBlob : $logsBlob, $m) === 1) {
                $publishDirectory = AgentDirectives::normalizePublishDirectory($m[1]);
            }

            if ($publishDirectory !== null && $applicationUuid !== null) {
                $settingsArgs = [
                    ...$appArgs,
                    'publish_directory' => $publishDirectory,
                    'redeploy' => true,
                    'reason' => "Harness: page nginx → publish_directory={$publishDirectory}",
                ];
                if ($alreadyStatic) {
                    $settingsArgs['is_static'] = true;
                }
                $settingsResult = $toolkit->execute('update_application_runtime_settings', $settingsArgs);
                $record('update_application_runtime_settings', $settingsArgs, $settingsResult);

                $headline = "publish_directory corrigé → {$publishDirectory} (page nginx par défaut).";
                $action = [
                    'kind' => 'runtime_settings',
                    'label' => 'publish_directory',
                    'detail' => $publishDirectory,
                    'ok' => ! isset($settingsResult['error']),
                    'at' => now()->toISOString(),
                ];
                $run->mergeMetadata([
                    'correction_actions' => [
                        ...((is_array($run->metadata['correction_actions'] ?? null)) ? $run->metadata['correction_actions'] : []),
                        $action,
                    ],
                    'correction' => [
                        'outcome' => isset($settingsResult['error']) ? 'partial' : 'fixed',
                        'headline' => $headline,
                        'diagnosis' => 'Page nginx stock servie — publish_directory incorrect pour le site statique.',
                        'source_scope' => 'runtime_settings',
                        'actions' => [$action],
                        'steps' => ["Mettre publish_directory={$publishDirectory}", 'Redéployer'],
                        'pills' => [
                            ['id' => 'build', 'label' => 'Build', 'active' => true, 'href' => null, 'detail' => "publish={$publishDirectory}"],
                            ['id' => 'redeploy', 'label' => 'Redeploy', 'active' => true, 'href' => null, 'detail' => 'lancé'],
                        ],
                        'belongs_to_deployment_uuid' => is_string($runContext['deployment_uuid'] ?? null)
                            ? $runContext['deployment_uuid']
                            : null,
                    ],
                ]);

                return [
                    'text' => $headline,
                    'steps' => $steps,
                ];
            }

            $headline = 'Page nginx par défaut — impossible de déduire publish_directory automatiquement.';
            $needsUserAction = [
                'kind' => 'needs_user',
                'label' => 'publish_directory',
                'detail' => $headline,
                'ok' => false,
                'at' => now()->toISOString(),
            ];
            $run->mergeMetadata([
                'correction_actions' => [
                    ...((is_array($run->metadata['correction_actions'] ?? null)) ? $run->metadata['correction_actions'] : []),
                    $needsUserAction,
                ],
                'correction' => [
                    'outcome' => 'needs_user',
                    'headline' => $headline,
                    'diagnosis' => 'Site statique qui sert la page nginx d’accueil — renseigner le dossier de build (dist/build/out…).',
                    'source_scope' => 'runtime_settings',
                    'actions' => [$needsUserAction],
                    'steps' => [
                        'Identifier le dossier de sortie du build (dist, build, out, public…).',
                        'Dans DevForge → Runtime → publish_directory = /dist (ou le bon dossier).',
                        'Redéployer.',
                    ],
                    'pills' => [
                        ['id' => 'build', 'label' => 'Build', 'active' => true, 'href' => null, 'detail' => 'publish_directory'],
                    ],
                    'belongs_to_deployment_uuid' => is_string($runContext['deployment_uuid'] ?? null)
                        ? $runContext['deployment_uuid']
                        : null,
                ],
            ]);

            return [
                'text' => $headline."\n\n1. Identifier le dossier de sortie du build.\n2. Définir publish_directory.\n3. Redéployer.",
                'steps' => $steps,
            ];
        } else {
            $excerptHint = '';
            $excerpt = is_array($runContext['failure_excerpt'] ?? null) ? $runContext['failure_excerpt'] : [];
            if ($excerpt !== []) {
                $excerptHint = ' Logs: '.mb_substr(collect($excerpt)
                    ->map(fn ($line): string => is_array($line) ? (string) ($line['message'] ?? '') : (string) $line)
                    ->filter()
                    ->take(-8)
                    ->implode(' | '), 0, 600);
            }

            $spawnArgs = [
                'goal' => (trim($goal) !== ''
                    ? $goal
                    : 'Réparer le déploiement de l\'application'.($applicationUuid ? " {$applicationUuid}" : ''))
                    .$excerptHint
                    .' — lire les logs, corriger via update_application_runtime_settings / upsert_application_env_var / write_application_source, puis redeploy 1×.',
                'difficulty' => 'heavy',
                'wait' => true,
                'leaf_profile' => 'fix',
            ];
            $spawnResult = $toolkit->execute('spawn_task', $spawnArgs);
            $record('spawn_task', $spawnArgs, $spawnResult);

            if (isset($spawnResult['error']) && $applicationUuid !== null) {
                $deployArgs = [
                    'uuid' => $applicationUuid,
                    'type' => 'applications',
                    'action' => 'deploy',
                    'reason' => 'Harness: redeploy après échec spawn_task',
                ];
                $deployResult = $toolkit->execute('control_resource', $deployArgs);
                $record('control_resource', $deployArgs, $deployResult);
            }
        }

        $hasError = collect($steps)->contains(fn (array $step): bool => ($step['status'] ?? '') === 'error');
        $correctiveDone = AgentChatRepairStrategy::stepsIncludeCorrectiveAction($steps);

        $text = $pendingApproval !== null
            ? "⏸ Approbation requise pour l’outil **{$pendingApproval['tool']}**.\n\n{$pendingApproval['reason']}"
            : ($correctiveDone
                ? ($hasError
                    ? 'Réparation partielle exécutée automatiquement. Voir les actions.'
                    : 'Réparation exécutée automatiquement. Voir les actions ci-dessus.')
                : 'Diagnostic automatique terminé — aucune correction outil applicable (secret manquant, cause hors scope, ou sous-agent sans action).');

        $payload = [
            'text' => $text,
            'steps' => $steps,
        ];

        if ($pendingApproval !== null) {
            $payload['pending_approval'] = $pendingApproval;
        }

        return $payload;
    }

    /**
     * @param  array<string, mixed>  $arguments
     */
    private function summarizeToolArgs(array $arguments): string
    {
        $parts = [];
        foreach ($arguments as $key => $value) {
            if (! is_scalar($value) && $value !== null) {
                continue;
            }
            $parts[] = $key.'='.mb_substr((string) $value, 0, 48);
            if (count($parts) >= 3) {
                break;
            }
        }

        return implode(', ', $parts);
    }

    /**
     * Crée une demande inbox (request_user_input) pour un token manquant — sans exposer de secret au LLM.
     */
    private function queueUserTokenRequest(
        AiAgent $agent,
        AiAgentRun $run,
        string $keyName,
        string $kind,
        string $message,
        ?string $resourceUuid,
    ): ?string {
        if (! Schema::hasTable('ai_agent_key_requests') || $agent->team_id === null) {
            return null;
        }

        $existing = AiAgentKeyRequest::query()
            ->where('team_id', $agent->team_id)
            ->where('key_name', $keyName)
            ->where('status', 'pending')
            ->when(
                $resourceUuid !== null && $resourceUuid !== '',
                fn ($q) => Schema::hasColumn('ai_agent_key_requests', 'resource_uuid')
                    ? $q->where('resource_uuid', $resourceUuid)
                    : $q,
            )
            ->first();

        if ($existing instanceof AiAgentKeyRequest) {
            return $existing->uuid;
        }

        $payload = [
            'team_id' => $agent->team_id,
            'agent_id' => $agent->id,
            'run_id' => $run->id,
            'key_name' => $keyName,
            'reason' => mb_substr($message, 0, 2000),
            'status' => 'pending',
        ];

        if (Schema::hasColumn('ai_agent_key_requests', 'kind')) {
            $payload['kind'] = $kind;
        }
        if (Schema::hasColumn('ai_agent_key_requests', 'resource_uuid') && $resourceUuid) {
            $payload['resource_uuid'] = $resourceUuid;
        }

        $request = AiAgentKeyRequest::create($payload);
        $run->appendLog("Demande utilisateur créée ({$keyName}) — inbox agents.");

        return $request->uuid;
    }

    /**
     * @param  array<string, mixed>  $result
     */
    private function summarizeToolResult(array $result): string
    {
        if (isset($result['error']) && is_string($result['error'])) {
            return mb_substr($result['error'], 0, 160);
        }

        if (($result['status'] ?? null) === 'ask' || ! empty($result['pending_approval'])) {
            return 'Approbation requise';
        }

        if (isset($result['ok']) && $result['ok'] === true) {
            $hint = is_string($result['hint'] ?? null) ? $result['hint'] : null;

            return $hint !== null ? mb_substr($hint, 0, 160) : 'OK';
        }

        if (is_string($result['message'] ?? null)) {
            return mb_substr($result['message'], 0, 160);
        }

        return 'OK';
    }
}
