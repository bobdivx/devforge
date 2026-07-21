<?php

namespace App\Services\DevForge\Agent;

use App\Models\AiAgent;
use App\Models\AiAgentRun;
use App\Models\Application;
use App\Services\DevForge\Application\ApplicationGitRepositoryParser;
use App\Services\DevForge\Application\GithubPackagesBuildAuthInjector;

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
        $issue = AgentChatRepairStrategy::detectIssue($logsBlob);

        if ($issue === AgentChatRepairStrategy::ISSUE_PERMISSIONS) {
            $fixArgs = [...$appArgs, 'redeploy' => true, 'reason' => 'Harness: Permission denied host'];
            $fixResult = $toolkit->execute('fix_application_host_permissions', $fixArgs);
            $record('fix_application_host_permissions', $fixArgs, $fixResult);
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
                            ['id' => 'env', 'label' => 'Env Coolify', 'active' => true, 'href' => null, 'detail' => 'NODE_AUTH_TOKEN (GitHub App)'],
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
                    ? 'Créez un PAT GitHub (read:packages), enregistrez-le dans Connexions, puis relancez le déploiement. Coolify injecte NODE_AUTH_TOKEN au build.'
                    : 'Un secret d’auth est requis — l’agent ne peut pas l’inventer.'));

            $needsUserAction = [
                'kind' => 'needs_user',
                'label' => 'Auth npm registry',
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
                    'diagnosis' => $diagnosisText,
                    'source_scope' => 'env',
                    'actions' => [$needsUserAction],
                    'steps' => $stepsText,
                    'pills' => [
                        [
                            'id' => 'connexions',
                            'label' => 'Ouvrir Connexions',
                            'active' => true,
                            'href' => '/connexions',
                            'detail' => 'token Packages',
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

            $text = $headline."\n\n".collect($stepsText)
                ->values()
                ->map(fn (string $step, int $index): string => ($index + 1).'. '.$step)
                ->implode("\n");

            return [
                'text' => $text,
                'steps' => $steps,
            ];
        } elseif ($issue === AgentChatRepairStrategy::ISSUE_NGINX_PUBLISH) {
            $publishDirectory = AgentDirectives::inferStaticPublishDirectory([
                ['message' => $logsBlob],
            ]);

            if ($publishDirectory === null && $applicationUuid !== null) {
                $sourceArgs = [...$appArgs, 'path' => '/'];
                $sourceResult = $toolkit->execute('list_application_source', $sourceArgs);
                $record('list_application_source', $sourceArgs, $sourceResult);
                $publishDirectory = AgentDirectives::pickStaticPublishDirectoryFromSourceEntries(
                    is_array($sourceResult['entries'] ?? null) ? $sourceResult['entries'] : [],
                );
            }

            if ($publishDirectory === null && preg_match('/ex\.\s*(\/[A-Za-z0-9._-]+)/iu', $logsBlob, $m) === 1) {
                $publishDirectory = AgentDirectives::normalizePublishDirectory($m[1]);
            }

            if ($publishDirectory !== null && $applicationUuid !== null) {
                $settingsArgs = [
                    ...$appArgs,
                    'publish_directory' => $publishDirectory,
                    'is_static' => true,
                    'redeploy' => true,
                    'reason' => "Harness: page nginx → publish_directory={$publishDirectory}",
                ];
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
                        'Dans Coolify → Runtime → publish_directory = /dist (ou le bon dossier).',
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
            $spawnArgs = [
                'goal' => trim($goal) !== ''
                    ? $goal
                    : 'Réparer le déploiement de l\'application'.($applicationUuid ? " {$applicationUuid}" : ''),
                'difficulty' => 'heavy',
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
        $correctiveDone = collect($steps)->contains(function (array $step): bool {
            $name = (string) ($step['name'] ?? '');

            return ($step['status'] ?? '') === 'done'
                && ! in_array($name, ['get_deployment_logs', 'spawn_task', 'list_application_env_vars', 'list_application_source', 'get_application_git_info', 'list_github_branches'], true);
        });

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
