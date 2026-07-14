<?php

namespace App\Services\DevForge\Agent;

use App\Enums\TaskModelTier;
use App\Models\AiAgent;
use App\Models\AiAgentRun;
use App\Services\DevForge\Agent\Tool\AgentSubagentRegistry;

/**
 * Délégation synchrone vers un sous-agent — inspiré de delegate_task (Forge).
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
    ): array {
        if ($parent->parent_agent_id !== null) {
            return ['error' => 'Un sous-agent ne peut pas déléguer à un autre agent.'];
        }

        $maxConcurrent = (int) config('devforge.agents_max_concurrent_subagents', 3);
        if ($this->registry->countActiveForParent($parent) >= $maxConcurrent) {
            return ['error' => "Limite de sous-agents simultanés atteinte (max {$maxConcurrent})."];
        }

        $child = $this->resolveChildAgent($parent, $childAgentUuid);
        if ($child === null) {
            return ['error' => 'Sous-agent introuvable. Créez un agent enfant (parent_agent_id) ou fournissez child_agent_uuid.'];
        }

        if (! $child->hasLlmProvider()) {
            return ['error' => 'Le sous-agent n\'a pas de provider LLM configuré.'];
        }

        $registryEntry = $this->registry->start($parent, $child, $parentRun, $goal);
        $parentRun->appendLog("  ↳ Délégation vers {$child->name} ({$child->uuid})");

        $childRun = AiAgentRun::create([
            'agent_id' => $child->id,
            'status' => 'pending',
            'trigger' => 'delegation',
        ]);

        $this->registry->markRunning($registryEntry, $childRun);

        try {
            $this->runner->run($child, $childRun, [
                'event' => 'delegated',
                'delegated_goal' => $goal,
                'parent_agent_uuid' => $parent->uuid,
                'parent_run_uuid' => $parentRun->uuid,
            ]);

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

    /**
     * Sous-tâche éphémère sur le même agent avec un tier de modèle adapté.
     *
     * @return array<string, mixed>
     */
    public function spawnEphemeral(
        AiAgent $parent,
        AiAgentRun $parentRun,
        string $goal,
        ?string $difficulty = 'auto',
    ): array {
        if ($parent->parent_agent_id !== null) {
            return ['error' => 'Un sous-agent ne peut pas lancer de sous-tâche éphémère.'];
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

        $parentRun->appendLog("  ↳ Sous-tâche éphémère — {$routing['display']} : ".mb_substr($goal, 0, 120));

        $childRun = AiAgentRun::create([
            'agent_id' => $parent->id,
            'status' => 'pending',
            'trigger' => 'ephemeral',
            'metadata' => [
                'ephemeral' => true,
                'parent_run_uuid' => $parentRun->uuid,
                'model_routing' => $routing,
            ],
        ]);

        try {
            $this->runner->run($parent, $childRun, [
                'event' => 'delegated',
                'delegated_goal' => $goal,
                'task_tier' => $tier,
                'ephemeral' => true,
                'parent_run_uuid' => $parentRun->uuid,
                'parent_agent_uuid' => $parent->uuid,
            ]);

            $childRun->refresh();

            $taskRecord = [
                'run_uuid' => $childRun->uuid,
                'goal' => mb_substr($goal, 0, 200),
                'tier' => $tier->value,
                'tier_label' => $tier->label(),
                'model_label' => $tier->modelLabel(),
                'display' => $routing['display'],
                'status' => $childRun->status,
                'summary' => $childRun->summary,
            ];

            $existing = $parentRun->metadata['ephemeral_tasks'] ?? [];
            $existing[] = $taskRecord;
            $parentRun->mergeMetadata(['ephemeral_tasks' => $existing]);

            if ($childRun->status === 'failed') {
                return [
                    'success' => false,
                    'ephemeral_run_uuid' => $childRun->uuid,
                    'model_routing' => $routing,
                    'error' => $childRun->summary,
                ];
            }

            return [
                'success' => true,
                'ephemeral_run_uuid' => $childRun->uuid,
                'model_routing' => $routing,
                'summary' => $childRun->summary ?? 'Sous-tâche terminée.',
            ];
        } catch (\Throwable $exception) {
            return [
                'success' => false,
                'error' => mb_substr($exception->getMessage(), 0, 500),
            ];
        }
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
