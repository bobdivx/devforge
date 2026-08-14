<?php

namespace App\Services\DevForge\Agent;

use App\Models\AiAgentRun;

/**
 * Builds a short structured correction summary from tool actions / logs.
 * Prefer metadata.correction_actions (recorded live); fall back to log parsing for legacy runs.
 */
class AgentRunCorrectionSummarizer
{
    private const USELESS_SUMMARY_CHARS = 320;

    /**
     * @return array{
     *     outcome: string,
     *     diagnosis: ?string,
     *     headline: string,
     *     source_scope: string,
     *     actions: array<int, array<string, mixed>>,
     *     pills: array<int, array<string, mixed>>,
     *     belongs_to_deployment_uuid: ?string
     * }
     */
    public function summarize(AiAgentRun $run): array
    {
        $actions = $this->collectActions($run);
        $outcome = $this->resolveOutcome($run, $actions);
        $sourceScope = $this->resolveSourceScope($actions);
        $headline = $this->buildHeadline($outcome, $actions, $sourceScope);
        $diagnosis = $this->extractDiagnosis($run, $headline);

        return [
            'outcome' => $outcome,
            'diagnosis' => $diagnosis,
            'headline' => $headline,
            'source_scope' => $sourceScope,
            'actions' => $actions,
            'pills' => $this->buildPills($actions),
            'belongs_to_deployment_uuid' => $this->belongsToDeploymentUuid($run),
        ];
    }

    /**
     * @param  array<string, mixed>  $correction
     * @return array<string, mixed>
     */
    public function sanitizePersistedCorrection(array $correction): array
    {
        $diagnosis = $correction['diagnosis'] ?? null;
        if (is_string($diagnosis) && AgentDirectives::containsCjkScript($diagnosis)) {
            $correction['diagnosis'] = null;
        }

        $headline = $correction['headline'] ?? null;
        if (is_string($headline) && AgentDirectives::containsCjkScript($headline)) {
            $correction['headline'] = 'Intervention agent terminée.';
        }

        $steps = $correction['steps'] ?? null;
        if (is_array($steps)) {
            $correction['steps'] = array_values(array_filter(
                $steps,
                static fn ($step): bool => is_string($step) && ! AgentDirectives::containsCjkScript($step),
            ));
        }

        return $correction;
    }

    /**
     * Persist correction metadata and a concise summary when the LLM dump is noisy.
     */
    public function finalize(AiAgentRun $run): void
    {
        $existing = is_array($run->metadata['correction'] ?? null) ? $run->metadata['correction'] : [];

        // Le harness peut poser un outcome needs_user (secret manquant, etc.) —
        // ne pas l’écraser par un no_action recalculé depuis les tool_calls.
        if (($existing['outcome'] ?? '') === 'needs_user') {
            $headline = trim((string) ($existing['headline'] ?? ''));
            if ($headline === '') {
                $headline = 'Action humaine requise.';
            }

            $current = trim((string) ($run->summary ?? ''));
            if (
                $this->shouldReplaceSummary($current, $headline)
                || str_contains(mb_strtolower($current), 'réparation exécutée')
                || str_contains(mb_strtolower($current), 'diagnostic automatique')
            ) {
                $run->update([
                    'summary' => mb_substr($headline, 0, 500),
                ]);
            }

            return;
        }

        $correction = $this->summarize($run);
        $run->mergeMetadata(['correction' => $correction]);

        $current = trim((string) ($run->summary ?? ''));
        if ($this->shouldReplaceSummary($current, $correction['headline'])) {
            $run->update([
                'summary' => mb_substr($correction['headline'], 0, 500),
            ]);
        }
    }

    public function shouldReplaceSummary(string $current, string $headline): bool
    {
        if ($headline === '') {
            return false;
        }

        if ($current === '') {
            return true;
        }

        if (AgentDirectives::containsCjkScript($current)) {
            return true;
        }

        if (mb_strlen($current) > self::USELESS_SUMMARY_CHARS) {
            return true;
        }

        if (substr_count($current, "\n") >= 3) {
            return true;
        }

        // Long Ollama-style reasoning often starts with analysis without stating an outcome.
        if (preg_match('/^(d[\'’]?accord|ok|bien|analys|je vais|let me|looking at|based on)/iu', $current) === 1
            && mb_strlen($current) > 160) {
            return true;
        }

        return false;
    }

    /**
     * Record a structured correction action during tool execution.
     *
     * @param  array<string, mixed>  $arguments
     * @param  array<string, mixed>  $result
     */
    public function recordToolResult(AiAgentRun $run, string $toolName, array $arguments, array $result): void
    {
        if (isset($result['error'])) {
            $corrective = in_array($toolName, [
                'upsert_application_env_var',
                'update_application_runtime_settings',
                'update_application_git_branch',
                'fix_application_host_permissions',
                'fix_coolify_base_config_path',
                'write_application_source',
                'control_resource',
                'exec_command',
                'write_remote_file',
            ], true);

            if (! $corrective) {
                return;
            }

            $run->mergeMetadata([
                'correction_actions' => [
                    ...((is_array($run->metadata['correction_actions'] ?? null)) ? $run->metadata['correction_actions'] : []),
                    [
                        'kind' => 'attempt_failed',
                        'label' => $toolName,
                        'detail' => mb_substr((string) $result['error'], 0, 200),
                        'ok' => false,
                        'at' => now()->toISOString(),
                    ],
                ],
            ]);

            return;
        }

        $entries = $this->actionsFromTool($toolName, $arguments, $result);

        if ($entries === []) {
            return;
        }

        $metadata = $run->metadata ?? [];
        $existing = is_array($metadata['correction_actions'] ?? null) ? $metadata['correction_actions'] : [];
        $run->mergeMetadata(['correction_actions' => [...$existing, ...$entries]]);
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    private function collectActions(AiAgentRun $run): array
    {
        $metadata = $run->metadata ?? [];
        $recorded = is_array($metadata['correction_actions'] ?? null) ? $metadata['correction_actions'] : [];

        if ($recorded !== []) {
            return array_values(array_filter($recorded, fn ($item): bool => is_array($item)));
        }

        $fromLogs = $this->parseActionsFromLogs((string) ($run->logs ?? ''));
        $fromTaken = $this->actionsFromTaken($run->actions_taken ?? []);

        return $this->mergeActions($fromLogs, $fromTaken);
    }

    /**
     * @param  array<string, mixed>  $arguments
     * @param  array<string, mixed>  $result
     * @return array<int, array<string, mixed>>
     */
    private function actionsFromTool(string $toolName, array $arguments, array $result): array
    {
        return match ($toolName) {
            'upsert_application_env_var' => [[
                'kind' => 'env_coolify',
                'label' => 'Variable Coolify',
                'detail' => (string) ($arguments['key'] ?? $result['variable']['key'] ?? ''),
                'ok' => true,
                'at' => now()->toISOString(),
            ]],
            'update_application_runtime_settings' => array_values(array_filter([
                [
                    'kind' => 'runtime_settings',
                    'label' => 'Build Coolify',
                    'detail' => implode(', ', array_map(
                        static fn ($key): string => (string) $key,
                        is_array($result['updated_keys'] ?? null)
                            ? $result['updated_keys']
                            : array_keys(array_filter(
                                $arguments,
                                static fn ($value, $key): bool => ! in_array($key, ['application_uuid', 'redeploy', 'reason'], true)
                                    && $value !== null,
                                ARRAY_FILTER_USE_BOTH,
                            )),
                    )),
                    'ok' => true,
                    'at' => now()->toISOString(),
                ],
                isset($result['redeploy']) && is_array($result['redeploy']) && ! isset($result['redeploy']['error'])
                    ? [
                        'kind' => 'redeploy',
                        'label' => 'Redéploiement',
                        'detail' => (string) ($arguments['reason'] ?? ''),
                        'deployment_uuid' => is_string($result['redeploy']['deployment_uuid'] ?? null)
                            ? $result['redeploy']['deployment_uuid']
                            : null,
                        'ok' => true,
                        'at' => now()->toISOString(),
                    ]
                    : null,
            ])),
            'fix_application_host_permissions' => array_values(array_filter([
                [
                    'kind' => 'host_permissions',
                    'label' => 'Permissions host',
                    'detail' => (string) ($result['path'] ?? $arguments['path'] ?? ''),
                    'ok' => true,
                    'at' => now()->toISOString(),
                ],
                isset($result['redeploy']) && is_array($result['redeploy']) && ! isset($result['redeploy']['error'])
                    ? [
                        'kind' => 'redeploy',
                        'label' => 'Redéploiement',
                        'detail' => (string) ($arguments['reason'] ?? ''),
                        'deployment_uuid' => is_string($result['redeploy']['deployment_uuid'] ?? null)
                            ? $result['redeploy']['deployment_uuid']
                            : null,
                        'ok' => true,
                        'at' => now()->toISOString(),
                    ]
                    : null,
            ])),
            'fix_coolify_base_config_path' => array_values(array_filter([
                [
                    'kind' => 'coolify_base_config',
                    'label' => 'Config Coolify',
                    'detail' => (string) ($result['container'] ?? $arguments['container'] ?? 'coolify'),
                    'ok' => true,
                    'at' => now()->toISOString(),
                ],
                isset($result['redeploy']) && is_array($result['redeploy']) && ! isset($result['redeploy']['error'])
                    ? [
                        'kind' => 'redeploy',
                        'label' => 'Redéploiement',
                        'detail' => (string) ($arguments['reason'] ?? ''),
                        'deployment_uuid' => is_string($result['redeploy']['deployment_uuid'] ?? null)
                            ? $result['redeploy']['deployment_uuid']
                            : null,
                        'ok' => true,
                        'at' => now()->toISOString(),
                    ]
                    : null,
            ])),
            'update_application_git_branch' => array_values(array_filter([
                [
                    'kind' => 'git_branch',
                    'label' => 'Branche Coolify',
                    'detail' => (string) ($arguments['git_branch'] ?? $result['git_branch'] ?? ''),
                    'ok' => true,
                    'at' => now()->toISOString(),
                ],
                isset($result['redeploy']) && is_array($result['redeploy']) && ! isset($result['redeploy']['error'])
                    ? [
                        'kind' => 'redeploy',
                        'label' => 'Redéploiement',
                        'detail' => (string) ($arguments['reason'] ?? ''),
                        'deployment_uuid' => is_string($result['redeploy']['deployment_uuid'] ?? null)
                            ? $result['redeploy']['deployment_uuid']
                            : null,
                        'ok' => true,
                        'at' => now()->toISOString(),
                    ]
                    : null,
            ])),
            'write_application_source' => $this->gitActionsFromWriteResult($arguments, $result),
            'control_resource' => ($arguments['action'] ?? '') === 'deploy' ? [[
                'kind' => 'redeploy',
                'label' => 'Redéploiement',
                'detail' => (string) ($arguments['reason'] ?? ''),
                'deployment_uuid' => is_string($result['deployment_uuid'] ?? null) ? $result['deployment_uuid'] : null,
                'ok' => true,
                'at' => now()->toISOString(),
            ]] : (($arguments['action'] ?? '') !== '' ? [[
                'kind' => 'control',
                'label' => (string) $arguments['action'],
                'detail' => (string) ($arguments['reason'] ?? ''),
                'ok' => true,
                'at' => now()->toISOString(),
            ]] : []),
            'exec_command' => [[
                'kind' => 'exec',
                'label' => 'Commande serveur',
                'detail' => mb_substr((string) ($arguments['command'] ?? ''), 0, 120),
                'ok' => true,
                'at' => now()->toISOString(),
            ]],
            'write_remote_file' => [[
                'kind' => 'remote_write',
                'label' => 'Fichier distant',
                'detail' => (string) ($arguments['path'] ?? ''),
                'ok' => true,
                'at' => now()->toISOString(),
            ]],
            default => [],
        };
    }

    /**
     * @param  array<string, mixed>  $arguments
     * @param  array<string, mixed>  $result
     * @return array<int, array<string, mixed>>
     */
    private function gitActionsFromWriteResult(array $arguments, array $result): array
    {
        $mode = (string) ($result['mode'] ?? $arguments['mode'] ?? 'direct');
        $path = (string) ($result['path'] ?? $arguments['path'] ?? '');
        $commitSha = is_string($result['commit_sha'] ?? null) ? $result['commit_sha'] : null;
        $commitUrl = is_string($result['commit_url'] ?? null) ? $result['commit_url'] : null;
        $prUrl = is_string($result['pull_request_url'] ?? null) ? $result['pull_request_url'] : null;
        $prNumber = is_numeric($result['pull_request_number'] ?? null) ? (int) $result['pull_request_number'] : null;

        $actions = [[
            'kind' => $mode === 'pull_request' ? 'pull_request' : 'git_commit',
            'label' => $mode === 'pull_request' ? 'Pull request' : 'Commit Git',
            'detail' => $path,
            'commit_sha' => $commitSha,
            'commit_url' => $commitUrl,
            'pr_url' => $prUrl,
            'pr_number' => $prNumber,
            'ok' => true,
            'at' => now()->toISOString(),
        ]];

        $redeployUuid = data_get($result, 'redeploy.deployment_uuid');
        if (is_string($redeployUuid) && $redeployUuid !== '') {
            $actions[] = [
                'kind' => 'redeploy',
                'label' => 'Redéploiement',
                'detail' => 'Après commit source',
                'deployment_uuid' => $redeployUuid,
                'ok' => true,
                'at' => now()->toISOString(),
            ];
        }

        return $actions;
    }

    /**
     * @param  array<int, array<string, mixed>>  $actionsTaken
     * @return array<int, array<string, mixed>>
     */
    private function actionsFromTaken(array $actionsTaken): array
    {
        $out = [];

        foreach ($actionsTaken as $action) {
            if (! is_array($action)) {
                continue;
            }

            if (($action['action'] ?? '') === 'deploy') {
                $out[] = [
                    'kind' => 'redeploy',
                    'label' => 'Redéploiement',
                    'detail' => (string) ($action['reason'] ?? ''),
                    'deployment_uuid' => is_string($action['deployment_uuid'] ?? null) ? $action['deployment_uuid'] : null,
                    'ok' => true,
                    'at' => $action['at'] ?? null,
                ];
            }
        }

        return $out;
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    private function parseActionsFromLogs(string $logs): array
    {
        if ($logs === '') {
            return [];
        }

        $actions = [];
        $lines = preg_split("/\r\n|\n|\r/", $logs) ?: [];

        foreach ($lines as $line) {
            if (str_contains($line, 'Variable Coolify') && str_contains($line, 'mise à jour')) {
                if (preg_match('/Variable Coolify\s+(\S+)\s+mise à jour/u', $line, $match) === 1) {
                    $actions[] = [
                        'kind' => 'env_coolify',
                        'label' => 'Variable Coolify',
                        'detail' => $match[1],
                        'ok' => true,
                    ];
                }
            }

            if (preg_match('/→ Outil:\s*upsert_application_env_var\((.+)\)\s*$/u', $line, $match) === 1) {
                $args = json_decode($match[1], true);
                if (is_array($args) && is_string($args['key'] ?? null)) {
                    $actions[] = [
                        'kind' => 'env_coolify',
                        'label' => 'Variable Coolify',
                        'detail' => $args['key'],
                        'ok' => true,
                    ];
                }
            }

            if (preg_match('/→ Outil:\s*write_application_source\((.+)\)\s*$/u', $line, $match) === 1) {
                $args = json_decode($match[1], true);
                if (is_array($args)) {
                    $mode = (string) ($args['mode'] ?? 'direct');
                    $actions[] = [
                        'kind' => $mode === 'pull_request' ? 'pull_request' : 'git_commit',
                        'label' => $mode === 'pull_request' ? 'Pull request' : 'Commit Git',
                        'detail' => (string) ($args['path'] ?? ''),
                        'ok' => true,
                    ];
                }
            }

            if (preg_match('/← Résultat:\s*(\{.+)/u', $line, $match) === 1) {
                $decoded = json_decode($match[1], true);
                if (! is_array($decoded) || isset($decoded['error'])) {
                    continue;
                }

                if (is_string($decoded['commit_sha'] ?? null) || is_string($decoded['commit_url'] ?? null)) {
                    $kind = (($decoded['mode'] ?? '') === 'pull_request') ? 'pull_request' : 'git_commit';
                    $actions[] = [
                        'kind' => $kind,
                        'label' => $kind === 'pull_request' ? 'Pull request' : 'Commit Git',
                        'detail' => (string) ($decoded['path'] ?? ''),
                        'commit_sha' => is_string($decoded['commit_sha'] ?? null) ? $decoded['commit_sha'] : null,
                        'commit_url' => is_string($decoded['commit_url'] ?? null) ? $decoded['commit_url'] : null,
                        'pr_url' => is_string($decoded['pull_request_url'] ?? null) ? $decoded['pull_request_url'] : null,
                        'pr_number' => is_numeric($decoded['pull_request_number'] ?? null) ? (int) $decoded['pull_request_number'] : null,
                        'ok' => true,
                    ];
                }

                $redeployUuid = data_get($decoded, 'redeploy.deployment_uuid');
                if (is_string($redeployUuid) && $redeployUuid !== '') {
                    $actions[] = [
                        'kind' => 'redeploy',
                        'label' => 'Redéploiement',
                        'deployment_uuid' => $redeployUuid,
                        'ok' => true,
                    ];
                }
            }

            if (preg_match('/✓ Action deploy sur/u', $line) === 1) {
                $actions[] = [
                    'kind' => 'redeploy',
                    'label' => 'Redéploiement',
                    'ok' => true,
                ];
            }

            if (preg_match('/→ Outil:\s*exec_command\((.+)\)\s*$/u', $line, $match) === 1) {
                $args = json_decode($match[1], true);
                $command = is_array($args) ? (string) ($args['command'] ?? '') : '';
                $actions[] = [
                    'kind' => 'exec',
                    'label' => 'Commande serveur',
                    'detail' => mb_substr($command, 0, 120),
                    'ok' => true,
                ];
            }
        }

        return $this->dedupeActions($actions);
    }

    /**
     * @param  array<int, array<string, mixed>>  $primary
     * @param  array<int, array<string, mixed>>  $secondary
     * @return array<int, array<string, mixed>>
     */
    private function mergeActions(array $primary, array $secondary): array
    {
        return $this->dedupeActions([...$primary, ...$secondary]);
    }

    /**
     * @param  array<int, array<string, mixed>>  $actions
     * @return array<int, array<string, mixed>>
     */
    private function dedupeActions(array $actions): array
    {
        $seen = [];
        $out = [];

        foreach ($actions as $action) {
            if (! is_array($action)) {
                continue;
            }

            $key = ($action['kind'] ?? '').'|'.($action['detail'] ?? '').'|'.($action['deployment_uuid'] ?? '').'|'.($action['commit_sha'] ?? '').'|'.($action['pr_url'] ?? '');
            if (isset($seen[$key])) {
                continue;
            }
            $seen[$key] = true;
            $out[] = $action;
        }

        return $out;
    }

    /**
     * @param  array<int, array<string, mixed>>  $actions
     */
    private function resolveOutcome(AiAgentRun $run, array $actions): string
    {
        $status = (string) $run->status;

        if (in_array($status, ['pending', 'running'], true)) {
            return 'running';
        }

        if ($status === 'failed') {
            return 'failed';
        }

        if ($actions === []) {
            return 'no_action';
        }

        $kinds = collect($actions)->pluck('kind')->filter()->values()->all();

        if (in_array('needs_user', $kinds, true)) {
            return 'needs_user';
        }

        $failedAttempts = collect($actions)->contains(fn (array $action): bool => ($action['ok'] ?? true) === false
            || ($action['kind'] ?? '') === 'attempt_failed');

        $hasFix = (bool) array_intersect($kinds, [
            'env_coolify',
            'runtime_settings',
            'host_permissions',
            'coolify_base_config',
            'git_commit',
            'git_branch',
            'pull_request',
            'remote_write',
            'exec',
            'control',
        ]);
        $hasRedeploy = in_array('redeploy', $kinds, true);

        if ($failedAttempts && ! $hasFix && ! $hasRedeploy) {
            return 'failed';
        }

        if ($hasRedeploy && ! $hasFix) {
            return 'redeploy_only';
        }

        if ($hasFix && $hasRedeploy) {
            return $failedAttempts ? 'partial' : 'fixed';
        }

        if ($hasFix) {
            return 'partial';
        }

        return $failedAttempts ? 'failed' : 'partial';
    }

    /**
     * @param  array<int, array<string, mixed>>  $actions
     */
    private function resolveSourceScope(array $actions): string
    {
        $kinds = collect($actions)->pluck('kind')->all();

        if (in_array('pull_request', $kinds, true)) {
            return 'pull_request';
        }

        if (in_array('git_commit', $kinds, true)) {
            return 'git_committed';
        }

        if (in_array('git_branch', $kinds, true)) {
            return 'git_branch';
        }

        if (in_array('host_permissions', $kinds, true)) {
            return 'host_permissions';
        }

        if (in_array('coolify_base_config', $kinds, true)) {
            return 'coolify_base_config';
        }

        if (in_array('runtime_settings', $kinds, true)) {
            return 'runtime_settings';
        }

        if (in_array('env_coolify', $kinds, true)) {
            return 'coolify_only';
        }

        if (in_array('redeploy', $kinds, true)) {
            return 'redeploy_only';
        }

        if ($actions !== []) {
            return 'server_side';
        }

        return 'none';
    }

    /**
     * @param  array<int, array<string, mixed>>  $actions
     */
    private function buildHeadline(string $outcome, array $actions, string $sourceScope): string
    {
        $envKeys = collect($actions)
            ->where('kind', 'env_coolify')
            ->pluck('detail')
            ->filter()
            ->unique()
            ->values();
        $runtimeDetail = collect($actions)
            ->where('kind', 'runtime_settings')
            ->pluck('detail')
            ->filter()
            ->first();
        $hostPath = collect($actions)
            ->where('kind', 'host_permissions')
            ->pluck('detail')
            ->filter()
            ->first();

        $needsUserDetail = collect($actions)
            ->where('kind', 'needs_user')
            ->pluck('detail')
            ->filter()
            ->first();

        return match ($outcome) {
            'running' => 'Intervention agent en cours…',
            'failed' => 'Échec de l’intervention agent.',
            'needs_user' => is_string($needsUserDetail) && $needsUserDetail !== ''
                ? $needsUserDetail
                : 'Action humaine requise (secret / config manquante).',
            'no_action' => 'Aucune action corrective (diagnostic seulement).',
            'redeploy_only' => 'Redéploiement lancé sans modification de code ni de variables.',
            'fixed' => match ($sourceScope) {
                'coolify_only' => $envKeys->isNotEmpty()
                    ? 'Variables Coolify mises à jour ('.$envKeys->implode(', ').') et redéploiement lancé.'
                    : 'Variables Coolify mises à jour et redéploiement lancé.',
                'runtime_settings' => $runtimeDetail
                    ? 'Config build Coolify mise à jour ('.$runtimeDetail.') et redéploiement lancé.'
                    : 'Config build Coolify mise à jour et redéploiement lancé.',
                'host_permissions' => $hostPath
                    ? 'Permissions host corrigées ('.$hostPath.') et redéploiement lancé.'
                    : 'Permissions host corrigées et redéploiement lancé.',
                'coolify_base_config' => 'Config Coolify (BASE_CONFIG_PATH) rechargée et redéploiement lancé.',
                'git_branch' => 'Branche Coolify corrigée et redéploiement lancé.',
                'git_committed' => 'Correction commitée sur Git et redéploiement lancé.',
                'pull_request' => 'Correction proposée via pull request.',
                default => 'Correction appliquée et redéploiement lancé.',
            },
            'partial' => match ($sourceScope) {
                'coolify_only' => $envKeys->isNotEmpty()
                    ? 'Variables Coolify mises à jour ('.$envKeys->implode(', ').') — redéploiement non confirmé.'
                    : 'Variables Coolify mises à jour — redéploiement non confirmé.',
                'runtime_settings' => $runtimeDetail
                    ? 'Config build Coolify mise à jour ('.$runtimeDetail.') — redéploiement non confirmé.'
                    : 'Config build Coolify mise à jour — redéploiement non confirmé.',
                'host_permissions' => $hostPath
                    ? 'Permissions host corrigées ('.$hostPath.') — redéploiement non confirmé.'
                    : 'Permissions host corrigées — redéploiement non confirmé.',
                'coolify_base_config' => 'Config Coolify (BASE_CONFIG_PATH) rechargée — redéploiement non confirmé.',
                'git_branch' => 'Branche Coolify mise à jour — vérifier le redéploiement.',
                'git_committed' => 'Commit Git effectué — vérifier le redéploiement.',
                'pull_request' => 'Pull request ouverte — pas de redéploiement automatique.',
                'server_side' => 'Actions serveur effectuées — résultat à vérifier.',
                default => 'Intervention partielle — voir les actions.',
            },
            default => 'Intervention agent terminée.',
        };
    }

    private function extractDiagnosis(AiAgentRun $run, string $headline): ?string
    {
        $summary = trim((string) ($run->summary ?? ''));

        if (
            $summary !== ''
            && $summary !== $headline
            && mb_strlen($summary) <= self::USELESS_SUMMARY_CHARS
            && ! AgentDirectives::containsCjkScript($summary)
        ) {
            return $summary;
        }

        $logs = (string) ($run->logs ?? '');
        if (preg_match('/Raisonnement:\s*(.+)$/mu', $logs, $match) === 1) {
            $snippet = trim($match[1]);
            if (
                $snippet !== ''
                && mb_strlen($snippet) <= 220
                && ! AgentDirectives::containsCjkScript($snippet)
            ) {
                return $snippet;
            }
        }

        return null;
    }

    /**
     * @param  array<int, array<string, mixed>>  $actions
     * @return array<int, array<string, mixed>>
     */
    private function buildPills(array $actions): array
    {
        $byKind = collect($actions)->groupBy(fn (array $a): string => (string) ($a['kind'] ?? ''));

        $pill = function (string $id, string $label, string $kind) use ($byKind): array {
            $items = $byKind->get($kind, collect());
            $first = $items->first();
            $href = null;

            if (is_array($first)) {
                $href = $first['pr_url'] ?? $first['commit_url'] ?? null;
            }

            return [
                'id' => $id,
                'label' => $label,
                'active' => $items->isNotEmpty(),
                'href' => is_string($href) && $href !== '' ? $href : null,
                'detail' => is_array($first) ? ($first['commit_sha'] ?? $first['detail'] ?? $first['deployment_uuid'] ?? null) : null,
            ];
        };

        return [
            $pill('env', 'Env Coolify', 'env_coolify'),
            $pill('build', 'Build', 'runtime_settings'),
            $pill('perms', 'Permissions', 'host_permissions'),
            $pill('basecfg', 'Config Coolify', 'coolify_base_config'),
            $pill('branch', 'Branche', 'git_branch'),
            $pill('commit', 'Commit Git', 'git_commit'),
            $pill('pr', 'PR', 'pull_request'),
            $pill('redeploy', 'Redeploy', 'redeploy'),
        ];
    }

    private function belongsToDeploymentUuid(AiAgentRun $run): ?string
    {
        $metadata = $run->metadata ?? [];
        if (is_string($metadata['deployment_uuid'] ?? null) && $metadata['deployment_uuid'] !== '') {
            return $metadata['deployment_uuid'];
        }

        $logs = (string) ($run->logs ?? '');
        if (preg_match('/"deployment_uuid"\s*:\s*"([^"]+)"/', $logs, $match) === 1) {
            return $match[1];
        }

        return null;
    }
}
