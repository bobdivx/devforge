<?php

namespace App\Services\DevForge\Agent;

use App\Events\AgentRunUpdated;
use App\Jobs\Agent\ResumeAgentAfterSubagentsJob;
use App\Jobs\Agent\RunAgentJob;
use App\Models\AiAgent;
use App\Models\AiAgentRun;
use App\Models\AiAgentSubagentRun;
use App\Services\DevForge\Agent\Tool\AgentSubagentCapabilities;
use App\Services\DevForge\Agent\Tool\AgentSubagentRegistry;

/**
 * Handoff parent ← leaf (inspiré OpenClaw task_completion / announce).
 */
class AgentSubagentHandoff
{
    public function __construct(
        private readonly AgentSubagentRegistry $registry,
    ) {}

    /**
     * Appelé quand un run leaf (éphémère ou délégation) se termine.
     */
    public function onLeafFinished(AiAgent $leafAgent, AiAgentRun $leafRun): void
    {
        $parentRunUuid = $leafRun->metadata['parent_run_uuid'] ?? null;
        if (! is_string($parentRunUuid) || $parentRunUuid === '') {
            return;
        }

        $parentRun = AiAgentRun::query()->where('uuid', $parentRunUuid)->first();
        if ($parentRun === null) {
            return;
        }

        $this->syncRegistry($parentRun, $leafAgent, $leafRun);

        $this->appendEphemeralTaskStatus($parentRun, $leafRun);

        broadcast(new AgentRunUpdated($parentRun->agent ?? $leafAgent, $parentRun->fresh() ?? $parentRun, 'subagent_finished'));

        $parentRun->refresh();
        if ($parentRun->status !== 'waiting_for_subagents') {
            return;
        }

        if ($this->hasActiveChildren($parentRun)) {
            return;
        }

        ResumeAgentAfterSubagentsJob::dispatch($parentRun->id);
    }

    /**
     * Dispatch les leafs en attente du yield parent.
     *
     * @return list<array<string, mixed>>
     */
    public function dispatchPendingLeafs(AiAgent $parent, AiAgentRun $parentRun): array
    {
        $pending = $parentRun->metadata['pending_leaf_spawns'] ?? [];
        if (! is_array($pending) || $pending === []) {
            return [];
        }

        $dispatched = [];

        foreach ($pending as $item) {
            if (! is_array($item)) {
                continue;
            }

            $runId = (int) ($item['run_id'] ?? 0);
            $childRun = $runId > 0 ? AiAgentRun::query()->whereKey($runId)->first() : null;
            if ($childRun === null || $childRun->status !== 'pending') {
                continue;
            }

            if (($childRun->metadata['awaiting_parent_yield'] ?? false) !== true) {
                continue;
            }

            $childAgent = AiAgent::query()->whereKey($childRun->agent_id)->first();
            if ($childAgent === null) {
                continue;
            }

            $meta = $childRun->metadata ?? [];
            unset($meta['awaiting_parent_yield']);
            $childRun->update(['metadata' => $meta]);

            $context = is_array($item['context'] ?? null) ? $item['context'] : [];
            $context['awaiting_parent_yield'] = false;
            if (isset($context['task_tier']) && is_string($context['task_tier'])) {
                $context['task_tier'] = \App\Enums\TaskModelTier::tryFromLoose($context['task_tier'])
                    ?? $context['task_tier'];
            }

            RunAgentJob::dispatch($childAgent, (string) ($childRun->trigger ?? 'ephemeral'), $context, $childRun->id);

            $registryId = (int) ($item['registry_id'] ?? 0);
            if ($registryId > 0) {
                $record = AiAgentSubagentRun::query()->whereKey($registryId)->first();
                if ($record !== null) {
                    $this->registry->markRunning($record, $childRun);
                }
            }

            $dispatched[] = [
                'run_uuid' => $childRun->uuid,
                'goal' => $item['goal'] ?? null,
            ];
            $parentRun->appendLog('  ↳ Leaf dispatché après yield : '.$childRun->uuid);
        }

        $parentRun->mergeMetadata(['pending_leaf_spawns' => []]);

        return $dispatched;
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function collectCompletions(AiAgentRun $parentRun): array
    {
        $tasks = $parentRun->metadata['ephemeral_tasks'] ?? [];
        if (! is_array($tasks)) {
            return [];
        }

        $completions = [];
        foreach ($tasks as $task) {
            if (! is_array($task)) {
                continue;
            }
            $status = (string) ($task['status'] ?? '');
            if (in_array($status, ['pending', 'running', 'queued'], true)) {
                continue;
            }
            $completions[] = [
                'run_uuid' => $task['run_uuid'] ?? null,
                'goal' => $task['goal'] ?? null,
                'status' => $status,
                'summary' => $task['summary'] ?? null,
                'contribution' => $task['contribution'] ?? $task['summary'] ?? null,
                'leaf_profile' => $task['leaf_profile'] ?? null,
                'role_slug' => $task['role_slug'] ?? null,
                'tier' => $task['tier'] ?? null,
                'model_label' => $task['model_label'] ?? null,
            ];
        }

        return $completions;
    }

    public function buildHandoffUserMessage(array $completions): string
    {
        $lines = [
            '[Subagent Completion]',
            AgentSubagentCapabilities::reviewInstruction(),
            '',
        ];

        foreach ($completions as $index => $item) {
            $n = $index + 1;
            $lines[] = "### Leaf #{$n}";
            $lines[] = '- goal: '.((string) ($item['goal'] ?? '—'));
            $lines[] = '- status: '.((string) ($item['status'] ?? '—'));
            $lines[] = '- run_uuid: '.((string) ($item['run_uuid'] ?? '—'));
            if (! empty($item['role_slug'])) {
                $lines[] = '- role: '.((string) $item['role_slug']);
            }
            if (! empty($item['leaf_profile'])) {
                $lines[] = '- profile: '.((string) $item['leaf_profile']);
            }
            if (! empty($item['model_label']) || ! empty($item['tier'])) {
                $lines[] = '- model: '.trim(((string) ($item['model_label'] ?? '')).' / '.((string) ($item['tier'] ?? '')), ' /');
            }
            $contribution = (string) ($item['contribution'] ?? $item['summary'] ?? '—');
            $lines[] = '- contribution: '.mb_substr($contribution, 0, 500);
            $lines[] = '- summary: '.mb_substr((string) ($item['summary'] ?? '—'), 0, 2000);
            $lines[] = '';
        }

        return implode("\n", $lines);
    }

    private function syncRegistry(AiAgentRun $parentRun, AiAgent $leafAgent, AiAgentRun $leafRun): void
    {
        $record = AiAgentSubagentRun::query()
            ->where('parent_run_id', $parentRun->id)
            ->where('child_run_id', $leafRun->id)
            ->latest('id')
            ->first();

        if ($record === null) {
            $record = AiAgentSubagentRun::query()
                ->where('parent_run_id', $parentRun->id)
                ->where('child_agent_id', $leafAgent->id)
                ->whereIn('status', [
                    AiAgentSubagentRun::STATUS_PENDING,
                    AiAgentSubagentRun::STATUS_QUEUED,
                    AiAgentSubagentRun::STATUS_RUNNING,
                ])
                ->latest('id')
                ->first();
        }

        if ($record === null) {
            return;
        }

        if ($leafRun->status === 'failed') {
            $this->registry->fail($record, $leafRun->summary ?? 'Échec leaf');
        } else {
            $this->registry->complete($record, $leafRun->summary);
        }
    }

    private function appendEphemeralTaskStatus(AiAgentRun $parentRun, AiAgentRun $leafRun): void
    {
        $tasks = $parentRun->metadata['ephemeral_tasks'] ?? [];
        if (! is_array($tasks)) {
            $tasks = [];
        }

        $updated = false;
        foreach ($tasks as $i => $task) {
            if (! is_array($task)) {
                continue;
            }
            if (($task['run_uuid'] ?? null) === $leafRun->uuid) {
                $tasks[$i]['status'] = $leafRun->status;
                $tasks[$i]['summary'] = $leafRun->summary;
                $tasks[$i]['contribution'] = mb_substr((string) ($leafRun->summary ?? ''), 0, 500);
                $tasks[$i]['role_slug'] = $tasks[$i]['role_slug'] ?? ($leafRun->metadata['role_slug'] ?? null);
                $tasks[$i]['leaf_profile'] = $tasks[$i]['leaf_profile'] ?? ($leafRun->metadata['leaf_profile'] ?? null);
                $tasks[$i]['tier'] = $tasks[$i]['tier'] ?? ($leafRun->metadata['task_tier'] ?? null);
                $tasks[$i]['model_label'] = $tasks[$i]['model_label']
                    ?? ($leafRun->metadata['model_routing']['model_label'] ?? null);
                $updated = true;
            }
        }

        if (! $updated) {
            $tasks[] = [
                'run_uuid' => $leafRun->uuid,
                'goal' => mb_substr((string) ($leafRun->metadata['delegated_goal'] ?? ''), 0, 200),
                'status' => $leafRun->status,
                'summary' => $leafRun->summary,
                'contribution' => mb_substr((string) ($leafRun->summary ?? ''), 0, 500),
                'leaf_profile' => $leafRun->metadata['leaf_profile'] ?? null,
                'role_slug' => $leafRun->metadata['role_slug'] ?? null,
                'tier' => $leafRun->metadata['task_tier'] ?? null,
                'model_label' => $leafRun->metadata['model_routing']['model_label'] ?? null,
            ];
        }

        $parentRun->mergeMetadata(['ephemeral_tasks' => $tasks]);
    }

    private function hasActiveChildren(AiAgentRun $parentRun): bool
    {
        $activeRegistry = AiAgentSubagentRun::query()
            ->where('parent_run_id', $parentRun->id)
            ->whereIn('status', [
                AiAgentSubagentRun::STATUS_PENDING,
                AiAgentSubagentRun::STATUS_QUEUED,
                AiAgentSubagentRun::STATUS_RUNNING,
            ])
            ->exists();

        if ($activeRegistry) {
            return true;
        }

        $pendingSpawns = $parentRun->metadata['pending_leaf_spawns'] ?? [];
        if (is_array($pendingSpawns) && $pendingSpawns !== []) {
            return true;
        }

        $tasks = $parentRun->metadata['ephemeral_tasks'] ?? [];
        if (! is_array($tasks)) {
            return false;
        }

        foreach ($tasks as $task) {
            if (! is_array($task)) {
                continue;
            }
            if (in_array((string) ($task['status'] ?? ''), ['pending', 'running', 'queued'], true)) {
                return true;
            }
        }

        return AiAgentRun::query()
            ->where('metadata->parent_run_uuid', $parentRun->uuid)
            ->whereIn('status', ['pending', 'running'])
            ->exists();
    }
}
