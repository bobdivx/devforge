<?php

namespace App\Services\DevForge\Agent;

use App\Models\AiAgentRun;

/**
 * Agrège les contributions multi-leaf en rapport structuré (P5.3).
 *
 * @phpstan-type Contribution array{
 *     role_slug: string|null,
 *     leaf_profile: string|null,
 *     run_uuid: string|null,
 *     status: string,
 *     tier: string|null,
 *     model_label: string|null,
 *     goal: string|null,
 *     contribution: string|null,
 *     tools_used: list<string>,
 *     risks: list<string>
 * }
 * @phpstan-type TeamReport array{
 *     generated_at: string,
 *     leaf_count: int,
 *     succeeded: int,
 *     failed: int,
 *     roles: list<string>,
 *     contributions: list<Contribution>,
 *     decisions: list<string>,
 *     risks: list<string>,
 *     markdown: string
 * }
 */
class AgentTeamReporter
{
    /**
     * @param  list<array<string, mixed>>  $completions
     * @return TeamReport
     */
    public function build(AiAgentRun $parentRun, array $completions = []): array
    {
        if ($completions === []) {
            $completions = app(AgentSubagentHandoff::class)->collectCompletions($parentRun);
        }

        $tasks = is_array($parentRun->metadata['ephemeral_tasks'] ?? null)
            ? $parentRun->metadata['ephemeral_tasks']
            : [];

        $byUuid = [];
        foreach ($tasks as $task) {
            if (! is_array($task) || empty($task['run_uuid'])) {
                continue;
            }
            $byUuid[(string) $task['run_uuid']] = $task;
        }

        $contributions = [];
        foreach ($completions as $item) {
            if (! is_array($item)) {
                continue;
            }
            $uuid = isset($item['run_uuid']) ? (string) $item['run_uuid'] : '';
            $task = $uuid !== '' && isset($byUuid[$uuid]) ? $byUuid[$uuid] : [];
            $leafRun = $this->findLeafRun($uuid !== '' ? $uuid : null);

            $summary = (string) ($item['summary'] ?? $task['summary'] ?? $leafRun?->summary ?? '');
            $contribution = (string) ($item['contribution'] ?? $task['contribution'] ?? $summary);
            $roleSlug = $this->nullableString($item['role_slug'] ?? $task['role_slug'] ?? $leafRun?->metadata['role_slug'] ?? null);
            $profile = $this->nullableString($item['leaf_profile'] ?? $task['leaf_profile'] ?? $leafRun?->metadata['leaf_profile'] ?? null);
            $status = (string) ($item['status'] ?? $task['status'] ?? $leafRun?->status ?? 'unknown');

            $contributions[] = [
                'role_slug' => $roleSlug,
                'leaf_profile' => $profile,
                'run_uuid' => $uuid !== '' ? $uuid : null,
                'status' => $status,
                'tier' => $this->nullableString($item['tier'] ?? $task['tier'] ?? $leafRun?->metadata['task_tier'] ?? null),
                'model_label' => $this->nullableString(
                    $item['model_label']
                    ?? $task['model_label']
                    ?? ($leafRun?->metadata['model_routing']['model_label'] ?? null),
                ),
                'goal' => $this->nullableString($item['goal'] ?? $task['goal'] ?? $leafRun?->metadata['delegated_goal'] ?? null),
                'contribution' => $contribution !== '' ? mb_substr($contribution, 0, 800) : null,
                'tools_used' => $this->extractToolsUsed($leafRun),
                'risks' => $this->extractRisks($summary.' '.$contribution),
            ];
        }

        if ($contributions === [] && $tasks !== []) {
            foreach ($tasks as $task) {
                if (! is_array($task)) {
                    continue;
                }
                $uuid = (string) ($task['run_uuid'] ?? '');
                $leafRun = $this->findLeafRun($uuid !== '' ? $uuid : null);
                $summary = (string) ($task['summary'] ?? $leafRun?->summary ?? '');
                $contributions[] = [
                    'role_slug' => $this->nullableString($task['role_slug'] ?? null),
                    'leaf_profile' => $this->nullableString($task['leaf_profile'] ?? null),
                    'run_uuid' => $uuid !== '' ? $uuid : null,
                    'status' => (string) ($task['status'] ?? 'unknown'),
                    'tier' => $this->nullableString($task['tier'] ?? null),
                    'model_label' => $this->nullableString($task['model_label'] ?? null),
                    'goal' => $this->nullableString($task['goal'] ?? null),
                    'contribution' => $summary !== '' ? mb_substr($summary, 0, 800) : null,
                    'tools_used' => $this->extractToolsUsed($leafRun),
                    'risks' => $this->extractRisks($summary),
                ];
            }
        }

        $succeeded = count(array_filter(
            $contributions,
            fn (array $c): bool => in_array($c['status'], ['completed', 'success'], true),
        ));
        $failed = count(array_filter(
            $contributions,
            fn (array $c): bool => in_array($c['status'], ['failed', 'error'], true),
        ));

        $roles = array_values(array_unique(array_filter(array_map(
            fn (array $c): string => (string) ($c['role_slug'] ?? $c['leaf_profile'] ?? ''),
            $contributions,
        ))));

        $allRisks = [];
        foreach ($contributions as $c) {
            foreach ($c['risks'] as $risk) {
                $allRisks[] = $risk;
            }
        }
        $allRisks = array_values(array_unique($allRisks));

        $decisions = $this->extractDecisions($contributions);

        $report = [
            'generated_at' => now()->toISOString(),
            'leaf_count' => count($contributions),
            'succeeded' => $succeeded,
            'failed' => $failed,
            'roles' => $roles,
            'contributions' => $contributions,
            'decisions' => $decisions,
            'risks' => $allRisks,
            'markdown' => '',
        ];
        $report['markdown'] = $this->toMarkdown($report);

        return $report;
    }

    /**
     * @param  list<array<string, mixed>>  $completions
     * @return TeamReport
     */
    public function persist(AiAgentRun $parentRun, array $completions = []): array
    {
        $report = $this->build($parentRun, $completions);
        $parentRun->mergeMetadata(['team_report' => $report]);
        $parentRun->appendLog(
            'Team report : '.$report['succeeded'].'/'.$report['leaf_count']
            .' leaf(s) OK — rôles: '.(implode(', ', $report['roles']) ?: '—'),
        );

        return $report;
    }

    /**
     * @return list<string>
     */
    private function extractToolsUsed(?AiAgentRun $leafRun): array
    {
        if ($leafRun === null) {
            return [];
        }

        $tools = [];
        foreach ($leafRun->actions_taken ?? [] as $action) {
            if (! is_array($action)) {
                continue;
            }
            $name = (string) ($action['tool'] ?? $action['action'] ?? $action['kind'] ?? '');
            if ($name !== '') {
                $tools[] = $name;
            }
        }

        if ($tools === [] && is_string($leafRun->logs) && $leafRun->logs !== '') {
            if (preg_match_all('/\b([a-z][a-z0-9_]{2,40})\s*(?:\(|→|:)/u', $leafRun->logs, $matches)) {
                foreach ($matches[1] as $candidate) {
                    if (str_contains($candidate, '_')) {
                        $tools[] = $candidate;
                    }
                }
            }
        }

        return array_values(array_unique(array_slice($tools, 0, 20)));
    }

    /**
     * @return list<string>
     */
    private function extractRisks(string $text): array
    {
        $text = mb_strtolower($text);
        if ($text === '') {
            return [];
        }

        $risks = [];
        $patterns = [
            'permission' => 'Permissions / accès',
            'secret|token|credential' => 'Secret / token manquant',
            'timeout|timed out' => 'Timeout',
            'failed|échec|erreur|error' => 'Échec signalé',
            'risk|risque|attention|warning' => 'Point d’attention',
            'manual|humain|intervention' => 'Intervention humaine possible',
        ];

        foreach ($patterns as $pattern => $label) {
            if (preg_match('/('.$pattern.')/u', $text) === 1) {
                $risks[] = $label;
            }
        }

        return array_values(array_unique($risks));
    }

    /**
     * @param  list<Contribution>  $contributions
     * @return list<string>
     */
    private function extractDecisions(array $contributions): array
    {
        $decisions = [];
        foreach ($contributions as $c) {
            $role = $c['role_slug'] ?? $c['leaf_profile'] ?? 'leaf';
            $status = $c['status'];
            $snippet = mb_substr((string) ($c['contribution'] ?? $c['goal'] ?? ''), 0, 120);
            if ($snippet === '') {
                continue;
            }
            $decisions[] = trim("{$role} [{$status}] : {$snippet}");
        }

        return array_slice($decisions, 0, 12);
    }

    /**
     * @param  TeamReport  $report
     */
    private function toMarkdown(array $report): string
    {
        $lines = [
            '## Team report',
            '',
            '- Leafs : '.$report['succeeded'].'/'.$report['leaf_count'].' OK'
                .($report['failed'] > 0 ? ' ('.$report['failed'].' échec(s))' : ''),
            '- Rôles : '.(implode(', ', $report['roles']) ?: '—'),
            '',
        ];

        foreach ($report['contributions'] as $index => $c) {
            $n = $index + 1;
            $label = $c['role_slug'] ?? $c['leaf_profile'] ?? 'leaf';
            $lines[] = "### #{$n} {$label}";
            $lines[] = '- status: '.$c['status'];
            if (! empty($c['model_label'])) {
                $lines[] = '- model: '.$c['model_label'].($c['tier'] ? ' / '.$c['tier'] : '');
            }
            if (! empty($c['tools_used'])) {
                $lines[] = '- tools: '.implode(', ', $c['tools_used']);
            }
            if (! empty($c['contribution'])) {
                $lines[] = '- contribution: '.$c['contribution'];
            }
            if (! empty($c['risks'])) {
                $lines[] = '- risks: '.implode('; ', $c['risks']);
            }
            $lines[] = '';
        }

        if ($report['risks'] !== []) {
            $lines[] = '### Risques agrégés';
            foreach ($report['risks'] as $risk) {
                $lines[] = '- '.$risk;
            }
            $lines[] = '';
        }

        return trim(implode("\n", $lines));
    }

    private function nullableString(mixed $value): ?string
    {
        if ($value === null) {
            return null;
        }
        $value = trim((string) $value);

        return $value === '' ? null : $value;
    }

    private function findLeafRun(?string $uuid): ?AiAgentRun
    {
        if ($uuid === null || $uuid === '') {
            return null;
        }

        try {
            return AiAgentRun::query()->where('uuid', $uuid)->first();
        } catch (\Throwable) {
            return null;
        }
    }
}
