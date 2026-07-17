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
     * Persist correction metadata and a concise summary when the LLM dump is noisy.
     */
    public function finalize(AiAgentRun $run): void
    {
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
        $hasFix = (bool) array_intersect($kinds, ['env_coolify', 'git_commit', 'pull_request', 'remote_write', 'exec', 'control']);
        $hasRedeploy = in_array('redeploy', $kinds, true);

        if ($hasRedeploy && ! $hasFix) {
            return 'redeploy_only';
        }

        if ($hasFix && $hasRedeploy) {
            return 'fixed';
        }

        if ($hasFix) {
            return 'partial';
        }

        return 'partial';
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

        return match ($outcome) {
            'running' => 'Intervention agent en cours…',
            'failed' => 'Échec de l’intervention agent.',
            'no_action' => 'Aucune action corrective (diagnostic seulement).',
            'redeploy_only' => 'Redéploiement lancé sans modification de code ni de variables.',
            'fixed' => match ($sourceScope) {
                'coolify_only' => $envKeys->isNotEmpty()
                    ? 'Variables Coolify mises à jour ('.$envKeys->implode(', ').') et redéploiement lancé.'
                    : 'Variables Coolify mises à jour et redéploiement lancé.',
                'git_committed' => 'Correction commitée sur Git et redéploiement lancé.',
                'pull_request' => 'Correction proposée via pull request.',
                default => 'Correction appliquée et redéploiement lancé.',
            },
            'partial' => match ($sourceScope) {
                'coolify_only' => $envKeys->isNotEmpty()
                    ? 'Variables Coolify mises à jour ('.$envKeys->implode(', ').') — redéploiement non confirmé.'
                    : 'Variables Coolify mises à jour — redéploiement non confirmé.',
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

        if ($summary !== '' && $summary !== $headline && mb_strlen($summary) <= self::USELESS_SUMMARY_CHARS) {
            return $summary;
        }

        $logs = (string) ($run->logs ?? '');
        if (preg_match('/Raisonnement:\s*(.+)$/mu', $logs, $match) === 1) {
            $snippet = trim($match[1]);
            if ($snippet !== '' && mb_strlen($snippet) <= 220) {
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
