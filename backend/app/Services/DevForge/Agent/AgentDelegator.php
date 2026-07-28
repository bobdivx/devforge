<?php

namespace App\Services\DevForge\Agent;

use App\Enums\TaskModelTier;
use App\Jobs\Agent\RunAgentJob;
use App\Models\AiAgent;
use App\Models\AiAgentRun;
use App\Models\AiAgentSubagentRun;
use App\Services\DevForge\Agent\Tool\AgentSubagentCapabilities;
use App\Services\DevForge\Agent\Tool\AgentSubagentRegistry;

/**
 * Délégation / spawn sous-agents — sync (wait) ou async + yield (patterns OpenClaw).
 */
class AgentDelegator
{
    public function __construct(
        private readonly AgentRunner $runner,
        private readonly AgentSubagentRegistry $registry,
        private readonly TaskModelRouter $taskModelRouter,
    ) {}

    /**
     * @return array<string, mixed>
     */
    public function delegate(
        AiAgent $parent,
        AiAgentRun $parentRun,
        string $goal,
        ?string $childAgentUuid = null,
        bool $wait = true,
    ): array {
        $guard = $this->assertCanSpawn($parent, $parentRun);
        if ($guard !== null) {
            return $guard;
        }

        $child = $this->resolveChildAgent($parent, $childAgentUuid);
        if ($child === null) {
            return ['error' => 'Sous-agent introuvable. Créez un agent enfant (parent_agent_id) ou fournissez child_agent_uuid.'];
        }

        if (! $child->hasLlmProvider()) {
            return ['error' => 'Le sous-agent n\'a pas de provider LLM configuré.'];
        }

        $parentDepth = AgentSubagentCapabilities::resolveDepth($parentRun->metadata ?? []);
        $context = [
            'event' => 'delegated',
            'delegated_goal' => $goal,
            'parent_agent_uuid' => $parent->uuid,
            'parent_run_uuid' => $parentRun->uuid,
            'subagent_role' => AgentSubagentCapabilities::ROLE_LEAF,
            'spawn_depth' => $parentDepth + 1,
        ];

        $registryEntry = $this->registry->start($parent, $child, $parentRun, $goal);
        $parentRun->appendLog("  ↳ Délégation vers {$child->name} ({$child->uuid})".($wait ? ' [sync]' : ' [async]'));

        $childRun = AiAgentRun::create([
            'agent_id' => $child->id,
            'status' => 'pending',
            'trigger' => 'delegation',
            'metadata' => [
                'parent_run_uuid' => $parentRun->uuid,
                'delegated_goal' => mb_substr($goal, 0, 500),
                'subagent_role' => AgentSubagentCapabilities::ROLE_LEAF,
                'spawn_depth' => $parentDepth + 1,
                'awaiting_parent_yield' => ! $wait,
            ],
        ]);

        if ($wait) {
            $this->registry->markRunning($registryEntry, $childRun);

            try {
                $this->runner->run($child, $childRun, $context);
                $childRun->refresh();
                $child->refresh();

                if ($childRun->status === 'failed') {
                    $this->registry->fail($registryEntry, $childRun->summary ?? 'Échec du sous-agent.');

                    return [
                        'success' => false,
                        'child_agent_uuid' => $child->uuid,
                        'child_run_uuid' => $childRun->uuid,
                        'error' => $childRun->summary,
                    ];
                }

                $output = $childRun->summary ?? 'Sous-agent terminé sans résumé.';
                $this->registry->complete($registryEntry, $output);

                return [
                    'success' => true,
                    'child_agent_uuid' => $child->uuid,
                    'child_run_uuid' => $childRun->uuid,
                    'summary' => $output,
                ];
            } catch (\Throwable $exception) {
                $this->registry->fail($registryEntry, $exception->getMessage());

                return [
                    'success' => false,
                    'error' => mb_substr($exception->getMessage(), 0, 500),
                ];
            }
        }

        $this->registry->markQueued($registryEntry, $childRun);
        $this->queuePendingLeaf($parentRun, $childRun, $registryEntry, $goal, $context);

        return [
            'success' => true,
            'async' => true,
            'status' => 'queued',
            'role' => AgentSubagentCapabilities::ROLE_LEAF,
            'child_agent_uuid' => $child->uuid,
            'child_run_uuid' => $childRun->uuid,
            'run_uuid' => $childRun->uuid,
            'hint' => 'Appelez yield_wait pour dispatcher et attendre les leafs.',
        ];
    }

    /**
     * Sous-tâche éphémère. Par défaut async (queue après yield) ; wait=true = sync.
     *
     * @return array<string, mixed>
     */
    public function spawnEphemeral(
        AiAgent $parent,
        AiAgentRun $parentRun,
        string $goal,
        ?string $difficulty = 'auto',
        bool $wait = false,
        ?string $leafProfile = null,
    ): array {
        $guard = $this->assertCanSpawn($parent, $parentRun);
        if ($guard !== null) {
            return $guard;
        }

        $goal = trim($goal);
        if ($goal === '') {
            return ['error' => 'Objectif de sous-tâche vide.'];
        }

        $tier = TaskModelTier::tryFromLoose($difficulty)
            ?? $this->taskModelRouter->classify($goal, 'ephemeral', $parent->type, ['event' => 'delegated']);

        $routing = $this->taskModelRouter->routingPayload(
            $tier,
            $this->taskModelRouter->reason($goal, 'ephemeral', $parent->type, ['ephemeral' => true], $tier),
        );

        $parentDepth = AgentSubagentCapabilities::resolveDepth(
            array_merge($parentRun->metadata ?? [], ['spawn_depth' => $parentRun->metadata['spawn_depth'] ?? 0]),
        );
        $leafDepth = $parentDepth + 1;

        $parentRun->appendLog(
            '  ↳ Sous-tâche éphémère — '.$routing['display']
            .($wait ? ' [sync]' : ' [async]')
            .($leafProfile ? " [{$leafProfile}]" : '')
            .' : '.mb_substr($goal, 0, 120),
        );

        $context = [
            'event' => 'delegated',
            'delegated_goal' => $goal,
            'task_tier' => $tier,
            'ephemeral' => true,
            'parent_run_uuid' => $parentRun->uuid,
            'parent_agent_uuid' => $parent->uuid,
            'subagent_role' => AgentSubagentCapabilities::ROLE_LEAF,
            'spawn_depth' => $leafDepth,
            'leaf_profile' => $leafProfile,
            'awaiting_parent_yield' => ! $wait,
        ];

        $childRun = AiAgentRun::create([
            'agent_id' => $parent->id,
            'status' => 'pending',
            'trigger' => 'ephemeral',
            'metadata' => [
                'ephemeral' => true,
                'parent_run_uuid' => $parentRun->uuid,
                'model_routing' => $routing,
                'delegated_goal' => mb_substr($goal, 0, 500),
                'subagent_role' => AgentSubagentCapabilities::ROLE_LEAF,
                'spawn_depth' => $leafDepth,
                'leaf_profile' => $leafProfile,
                'awaiting_parent_yield' => ! $wait,
            ],
        ]);

        $registryEntry = $this->registry->start($parent, $parent, $parentRun, $goal);

        $taskRecord = [
            'run_uuid' => $childRun->uuid,
            'goal' => mb_substr($goal, 0, 200),
            'tier' => $tier->value,
            'tier_label' => $tier->label(),
            'model_label' => $tier->modelLabel(),
            'display' => $routing['display'],
            'status' => $wait ? 'running' : 'queued',
            'summary' => null,
            'leaf_profile' => $leafProfile,
            'async' => ! $wait,
        ];
        $existing = $parentRun->metadata['ephemeral_tasks'] ?? [];
        if (! is_array($existing)) {
            $existing = [];
        }
        $existing[] = $taskRecord;
        $parentRun->mergeMetadata(['ephemeral_tasks' => $existing]);

        if ($wait) {
            $this->registry->markRunning($registryEntry, $childRun);

            try {
                $this->runner->run($parent, $childRun, $context);
                $childRun->refresh();

                $this->updateEphemeralTaskRecord($parentRun, $childRun);

                if ($childRun->status === 'failed') {
                    $this->registry->fail($registryEntry, $childRun->summary ?? 'Échec');

                    return [
                        'success' => false,
                        'ephemeral_run_uuid' => $childRun->uuid,
                        'model_routing' => $routing,
                        'error' => $childRun->summary,
                    ];
                }

                $this->registry->complete($registryEntry, $childRun->summary);

                return [
                    'success' => true,
                    'ephemeral_run_uuid' => $childRun->uuid,
                    'model_routing' => $routing,
                    'summary' => $childRun->summary ?? 'Sous-tâche terminée.',
                ];
            } catch (\Throwable $exception) {
                $this->registry->fail($registryEntry, $exception->getMessage());

                return [
                    'success' => false,
                    'error' => mb_substr($exception->getMessage(), 0, 500),
                ];
            }
        }

        $this->registry->markQueued($registryEntry, $childRun);
        $this->queuePendingLeaf($parentRun, $childRun, $registryEntry, $goal, $context);

        return [
            'success' => true,
            'async' => true,
            'status' => 'queued',
            'role' => AgentSubagentCapabilities::ROLE_LEAF,
            'run_uuid' => $childRun->uuid,
            'ephemeral_run_uuid' => $childRun->uuid,
            'model_routing' => $routing,
            'leaf_profile' => $leafProfile,
            'hint' => 'Appelez yield_wait pour dispatcher et attendre les leafs.',
        ];
    }

    /**
     * Marque le parent en waiting_for_subagents et dispatch les leafs en file.
     *
     * @param  array<string, mixed>  $resumeContext
     * @return array<string, mixed>
     */
    public function yieldWait(AiAgent $parent, AiAgentRun $parentRun, array $resumeContext = []): array
    {
        $pending = $parentRun->metadata['pending_leaf_spawns'] ?? [];
        $tasks = $parentRun->metadata['ephemeral_tasks'] ?? [];
        $hasQueued = (is_array($pending) && $pending !== [])
            || (is_array($tasks) && collect($tasks)->contains(
                fn ($t) => is_array($t) && in_array((string) ($t['status'] ?? ''), ['queued', 'pending', 'running'], true),
            ));

        if (! $hasQueued && $this->registry->countActiveForParentRun($parentRun) === 0) {
            return ['error' => 'Aucun sous-agent en attente. Appelez spawn_task avant yield_wait.'];
        }

        $parentRun->mergeMetadata([
            'resume_context' => array_merge(
                is_array($parentRun->metadata['resume_context'] ?? null) ? $parentRun->metadata['resume_context'] : [],
                $resumeContext,
                [
                    'subagent_role' => AgentSubagentCapabilities::resolveRole(
                        array_merge($parentRun->metadata ?? [], $resumeContext),
                    ),
                    'spawn_depth' => AgentSubagentCapabilities::resolveDepth(
                        array_merge($parentRun->metadata ?? [], $resumeContext),
                    ),
                ],
            ),
        ]);

        $handoff = app(AgentSubagentHandoff::class);
        $dispatched = $handoff->dispatchPendingLeafs($parent, $parentRun);

        $parentRun->refresh();
        $parentRun->update([
            'status' => 'waiting_for_subagents',
            'summary' => 'En attente de '.max(count($dispatched), 1).' sous-agent(s)…',
            'finished_at' => now(),
        ]);
        $parentRun->appendLog('yield_wait : parent en pause, leafs dispatchés ('.count($dispatched).').');

        $parent->update(['status' => 'idle', 'last_run_at' => now()]);

        return [
            'success' => true,
            'status' => 'waiting_for_subagents',
            'dispatched' => $dispatched,
            'message' => 'Parent en pause jusqu’à complétion des leafs (handoff automatique).',
        ];
    }

    /**
     * Batch de sous-tâches éphémères en parallèle (queue) — plus de batch_sequential.
     *
     * @param  list<array{goal?: string, difficulty?: string, leaf_profile?: string, wait?: bool}>  $tasks
     * @return array<string, mixed>
     */
    public function spawnMany(AiAgent $parent, AiAgentRun $parentRun, array $tasks): array
    {
        $max = max(1, (int) config('devforge.agents_max_concurrent_subagents', 3));
        $slice = array_slice(array_values($tasks), 0, $max);
        $results = [];
        $allWait = true;

        foreach ($slice as $index => $task) {
            if (! is_array($task)) {
                continue;
            }
            $goal = trim((string) ($task['goal'] ?? ''));
            if ($goal === '') {
                $results[] = ['index' => $index, 'success' => false, 'error' => 'goal vide'];

                continue;
            }
            $difficulty = isset($task['difficulty']) ? (string) $task['difficulty'] : 'auto';
            $wait = ($task['wait'] ?? false) === true;
            if (! $wait) {
                $allWait = false;
            }
            $leafProfile = isset($task['leaf_profile']) ? (string) $task['leaf_profile'] : null;
            $parentRun->appendLog('  ↳ Batch spawn #'.($index + 1).'/'.count($slice));
            $results[] = array_merge(
                ['index' => $index],
                $this->spawnEphemeral($parent, $parentRun, $goal, $difficulty, $wait, $leafProfile),
            );
        }

        $ok = collect($results)->where('success', true)->count();

        return [
            'success' => $ok === count($results) && $results !== [],
            'mode' => $allWait ? 'batch_sync' : 'batch_parallel_async',
            'requested' => count($tasks),
            'executed' => count($results),
            'succeeded' => $ok,
            'results' => $results,
            'hint' => $allWait ? null : 'Appelez yield_wait pour dispatcher et attendre.',
        ];
    }

    /**
     * @param  list<array{goal?: string, child_agent_uuid?: string}>  $tasks
     * @return array<string, mixed>
     */
    public function delegateMany(AiAgent $parent, AiAgentRun $parentRun, array $tasks): array
    {
        $guard = $this->assertCanSpawn($parent, $parentRun);
        if ($guard !== null) {
            return $guard;
        }

        $max = max(1, (int) config('devforge.agents_max_concurrent_subagents', 3));
        $slice = array_slice(array_values($tasks), 0, $max);

        if ($slice === []) {
            return ['error' => 'Aucune tâche à déléguer.'];
        }

        if (count($slice) === 1) {
            $task = $slice[0];
            $goal = trim((string) ($task['goal'] ?? ''));
            $childUuid = isset($task['child_agent_uuid']) ? (string) $task['child_agent_uuid'] : null;
            $wait = ($task['wait'] ?? true) === true;

            return array_merge(
                ['mode' => 'single'],
                $this->delegate($parent, $parentRun, $goal, $childUuid, $wait),
            );
        }

        $pending = [];
        $parentDepth = AgentSubagentCapabilities::resolveDepth($parentRun->metadata ?? []);

        foreach ($slice as $index => $task) {
            if (! is_array($task)) {
                continue;
            }
            $goal = trim((string) ($task['goal'] ?? ''));
            if ($goal === '') {
                $pending[] = ['index' => $index, 'success' => false, 'error' => 'goal vide'];

                continue;
            }

            $childUuid = isset($task['child_agent_uuid']) ? (string) $task['child_agent_uuid'] : null;
            $child = $this->resolveChildAgent($parent, $childUuid);
            if ($child === null || ! $child->hasLlmProvider()) {
                $pending[] = [
                    'index' => $index,
                    'success' => false,
                    'error' => 'Sous-agent introuvable ou sans provider.',
                ];

                continue;
            }

            $child->prepareForEventDispatch();
            $child->refresh();

            $childRun = AiAgentRun::create([
                'agent_id' => $child->id,
                'status' => 'pending',
                'trigger' => 'delegation',
                'metadata' => [
                    'parent_run_uuid' => $parentRun->uuid,
                    'delegated_goal' => mb_substr($goal, 0, 500),
                    'parallel_batch' => true,
                    'subagent_role' => AgentSubagentCapabilities::ROLE_LEAF,
                    'spawn_depth' => $parentDepth + 1,
                ],
            ]);

            $child->update(['status' => 'running']);

            RunAgentJob::dispatch($child, 'delegation', [
                'event' => 'delegated',
                'delegated_goal' => $goal,
                'parent_agent_uuid' => $parent->uuid,
                'parent_run_uuid' => $parentRun->uuid,
                'parallel_batch' => true,
                'subagent_role' => AgentSubagentCapabilities::ROLE_LEAF,
                'spawn_depth' => $parentDepth + 1,
            ], $childRun->id);

            $pending[] = [
                'index' => $index,
                'child_agent_uuid' => $child->uuid,
                'child_run_id' => $childRun->id,
                'child_run_uuid' => $childRun->uuid,
                'goal' => mb_substr($goal, 0, 200),
            ];
            $parentRun->appendLog("  ↳ Délégation parallèle #{$index} → {$child->name}");
        }

        $timeoutSeconds = max(30, (int) config('devforge.agents_parallel_delegate_timeout', 600));
        $deadline = microtime(true) + $timeoutSeconds;
        $results = [];

        foreach ($pending as $item) {
            if (isset($item['success'])) {
                $results[] = $item;

                continue;
            }

            $runId = (int) ($item['child_run_id'] ?? 0);
            $run = null;

            while (microtime(true) < $deadline) {
                $run = AiAgentRun::query()->whereKey($runId)->first();
                if ($run && ! in_array($run->status, ['pending', 'running'], true)) {
                    break;
                }
                usleep(400_000);
            }

            $run ??= AiAgentRun::query()->whereKey($runId)->first();

            if (! $run) {
                $results[] = array_merge($item, ['success' => false, 'error' => 'Run introuvable']);

                continue;
            }

            if (in_array($run->status, ['pending', 'running'], true)) {
                $results[] = array_merge($item, [
                    'success' => false,
                    'status' => $run->status,
                    'error' => 'Timeout attente sous-agent',
                ]);

                continue;
            }

            $results[] = array_merge($item, [
                'success' => $run->status === 'completed',
                'status' => $run->status,
                'summary' => $run->summary,
                'error' => $run->status === 'failed' ? $run->summary : null,
            ]);
        }

        $ok = collect($results)->where('success', true)->count();

        return [
            'success' => $ok === count($results) && $results !== [],
            'mode' => 'parallel_queue',
            'requested' => count($tasks),
            'executed' => count($results),
            'succeeded' => $ok,
            'results' => $results,
        ];
    }

    /**
     * @return array<string, mixed>|null
     */
    private function assertCanSpawn(AiAgent $parent, AiAgentRun $parentRun): ?array
    {
        $context = array_merge($parentRun->metadata ?? [], [
            'ephemeral' => false,
            'subagent_role' => $parentRun->metadata['subagent_role'] ?? AgentSubagentCapabilities::ROLE_MAIN,
            'spawn_depth' => $parentRun->metadata['spawn_depth'] ?? 0,
        ]);

        if (! AgentSubagentCapabilities::canSpawn($context, $parent->parent_agent_id !== null)) {
            return ['error' => 'Spawn interdit pour ce rôle/profondeur (leaf ou max_spawn_depth atteint).'];
        }

        $maxConcurrent = (int) config('devforge.agents_max_concurrent_subagents', 3);
        if ($this->registry->countActiveForParent($parent) >= $maxConcurrent) {
            return ['error' => "Limite de sous-agents simultanés atteinte (max {$maxConcurrent})."];
        }

        return null;
    }

    /**
     * @param  array<string, mixed>  $context
     */
    private function queuePendingLeaf(
        AiAgentRun $parentRun,
        AiAgentRun $childRun,
        AiAgentSubagentRun $registryEntry,
        string $goal,
        array $context,
    ): void {
        $pending = $parentRun->metadata['pending_leaf_spawns'] ?? [];
        if (! is_array($pending)) {
            $pending = [];
        }

        $pending[] = [
            'run_id' => $childRun->id,
            'run_uuid' => $childRun->uuid,
            'registry_id' => $registryEntry->id,
            'goal' => mb_substr($goal, 0, 200),
            'context' => array_merge($context, [
                // task_tier enum non sérialisable pour le metadata JSON — on retire
                'task_tier' => $context['task_tier'] instanceof TaskModelTier
                    ? $context['task_tier']->value
                    : ($context['task_tier'] ?? null),
            ]),
        ];

        // Nettoyer task_tier objet pour metadata
        foreach ($pending as $i => $item) {
            if (isset($item['context']['task_tier']) && $item['context']['task_tier'] instanceof TaskModelTier) {
                $pending[$i]['context']['task_tier'] = $item['context']['task_tier']->value;
            }
        }

        $parentRun->mergeMetadata(['pending_leaf_spawns' => $pending]);
    }

    private function updateEphemeralTaskRecord(AiAgentRun $parentRun, AiAgentRun $childRun): void
    {
        $tasks = $parentRun->metadata['ephemeral_tasks'] ?? [];
        if (! is_array($tasks)) {
            return;
        }

        foreach ($tasks as $i => $task) {
            if (! is_array($task)) {
                continue;
            }
            if (($task['run_uuid'] ?? null) === $childRun->uuid) {
                $tasks[$i]['status'] = $childRun->status;
                $tasks[$i]['summary'] = $childRun->summary;
            }
        }

        $parentRun->mergeMetadata(['ephemeral_tasks' => $tasks]);
    }

    private function resolveChildAgent(AiAgent $parent, ?string $childAgentUuid): ?AiAgent
    {
        if ($childAgentUuid !== null && $childAgentUuid !== '') {
            $child = AiAgent::query()
                ->where('team_id', $parent->team_id)
                ->where('uuid', $childAgentUuid)
                ->first();

            if ($child === null) {
                return null;
            }

            if ($child->parent_agent_id !== $parent->id) {
                return null;
            }

            return $child;
        }

        return AiAgent::query()
            ->where('parent_agent_id', $parent->id)
            ->where('is_active', true)
            ->orderBy('name')
            ->first();
    }
}
