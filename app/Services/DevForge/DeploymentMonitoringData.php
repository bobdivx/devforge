<?php

namespace App\Services\DevForge;

use App\Models\AiAgentRun;
use App\Models\AiAgentSubagentRun;
use App\Models\ApplicationDeploymentQueue;
use App\Models\Team;
use App\Services\DevForge\Agent\DeploymentAgentCatchUp;
use App\Services\DevForge\Agent\DeploymentAgentResolver;
use Illuminate\Support\Collection;

class DeploymentMonitoringData
{
    private const CONTEXT_PREFIX = 'Contexte événement: ';

    public function __construct(
        private readonly DeploymentData $deploymentData,
        private readonly DeploymentAgentResolver $agentResolver,
        private readonly DeploymentAgentCatchUp $agentCatchUp,
    ) {}

    /**
     * @return array<string, mixed>
     */
    public function forDeployment(Team $team, ApplicationDeploymentQueue $deployment): array
    {
        $deploymentUuid = (string) $deployment->deployment_uuid;
        $runs = $this->findRunsForDeployment($team, $deploymentUuid);
        $catchUpTriggered = false;

        if ($runs->isEmpty()) {
            $catchUpTriggered = $this->agentCatchUp->maybeDispatch($deployment);

            if ($catchUpTriggered) {
                $runs = $this->findRunsForDeployment($team, $deploymentUuid);
            }
        }

        $applicationUuid = $deployment->application?->uuid;

        return [
            'deployment' => $this->deploymentData->deployment($deployment),
            'agent_runs' => $runs
                ->map(fn (AiAgentRun $run): array => $this->presentAgentRun($run))
                ->values()
                ->all(),
            'redeployments' => $this->resolveRedeployments($team, $runs),
            'agents' => [
                'enabled' => (bool) config('devforge.agents_enabled'),
                'auto_fix_deployments' => (bool) config('devforge.agents_auto_fix_deployments'),
                'monitor_build' => (bool) config('devforge.agents_monitor_build_enabled'),
                'webhook_build' => (bool) config('devforge.agents_monitor_build_enabled'),
            ],
            'diagnostics' => $this->agentResolver->diagnostics($team, is_string($applicationUuid) ? $applicationUuid : null),
            'catch_up_triggered' => $catchUpTriggered,
        ];
    }

    /**
     * @return Collection<int, AiAgentRun>
     */
    private function findRunsForDeployment(Team $team, string $deploymentUuid): Collection
    {
        return AiAgentRun::query()
            ->with('agent')
            ->where(function ($query) use ($deploymentUuid): void {
                $query->where('logs', 'like', '%"deployment_uuid":"'.$deploymentUuid.'"%')
                    ->orWhere('metadata->deployment_uuid', $deploymentUuid);
            })
            ->whereHas('agent', fn ($query) => $query->where('team_id', $team->id))
            ->latest()
            ->limit(10)
            ->get();
    }

    /**
     * @return array<string, mixed>
     */
    private function presentAgentRun(AiAgentRun $run): array
    {
        $agent = $run->agent;

        return [
            'uuid' => $run->uuid,
            'status' => $run->status,
            'trigger' => $run->trigger,
            'summary' => $run->summary,
            'actions_taken' => $run->actions_taken ?? [],
            'iterations' => $run->iterations,
            'tokens_used' => $run->tokens_used,
            'duration_seconds' => $run->duration_in_seconds,
            'started_at' => $run->started_at?->toISOString(),
            'finished_at' => $run->finished_at?->toISOString(),
            'created_at' => $run->created_at->toISOString(),
            'event_context' => $this->parseEventContext($run->logs) ?? $this->metadataEventContext($run),
            'metadata' => $run->metadata ?? [],
            'subagent_runs' => $this->presentSubagentRuns($run),
            'logs' => $run->logs,
            'agent' => $agent ? [
                'uuid' => $agent->uuid,
                'name' => $agent->name,
                'type' => $agent->type,
                'avatar_color' => $agent->avatar_color,
            ] : null,
        ];
    }

    /**
     * @param  Collection<int, AiAgentRun>  $runs
     * @return array<int, array<string, mixed>>
     */
    private function resolveRedeployments(Team $team, Collection $runs): array
    {
        $deploymentUuids = $runs
            ->flatMap(function (AiAgentRun $run): array {
                return collect($run->actions_taken ?? [])
                    ->filter(fn (array $action): bool => ($action['action'] ?? '') === 'deploy')
                    ->map(fn (array $action): ?string => is_string($action['deployment_uuid'] ?? null) ? $action['deployment_uuid'] : null)
                    ->filter()
                    ->values()
                    ->all();
            })
            ->unique()
            ->values();

        return $deploymentUuids
            ->map(function (string $uuid) use ($team): ?array {
                try {
                    $deployment = $this->deploymentData->find($team, $uuid);

                    return $this->deploymentData->deployment($deployment);
                } catch (\Throwable) {
                    return null;
                }
            })
            ->filter()
            ->values()
            ->all();
    }

    /**
     * @return array<string, mixed>|null
     */
    private function parseEventContext(?string $logs): ?array
    {
        if ($logs === null || $logs === '') {
            return null;
        }

        foreach (explode("\n", $logs) as $line) {
            $position = strpos($line, self::CONTEXT_PREFIX);

            if ($position === false) {
                continue;
            }

            $json = substr($line, $position + strlen(self::CONTEXT_PREFIX));
            $decoded = json_decode($json, true);

            if (is_array($decoded)) {
                return $decoded;
            }
        }

        return null;
    }

    /**
     * @return array<string, mixed>|null
     */
    private function metadataEventContext(AiAgentRun $run): ?array
    {
        $metadata = $run->metadata;

        if (! is_array($metadata) || ! isset($metadata['event'])) {
            return null;
        }

        return array_filter([
            'event' => is_string($metadata['event'] ?? null) ? $metadata['event'] : null,
            'deployment_uuid' => is_string($metadata['deployment_uuid'] ?? null) ? $metadata['deployment_uuid'] : null,
            'application_uuid' => is_string($metadata['application_uuid'] ?? null) ? $metadata['application_uuid'] : null,
        ], fn (?string $value): bool => $value !== null && $value !== '');
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    private function presentSubagentRuns(AiAgentRun $run): array
    {
        return AiAgentSubagentRun::query()
            ->with(['childAgent', 'childRun'])
            ->where('parent_run_id', $run->id)
            ->latest()
            ->get()
            ->map(function (AiAgentSubagentRun $entry): array {
                $child = $entry->childAgent;
                $childRun = $entry->childRun;

                return [
                    'uuid' => (string) $entry->id,
                    'status' => $entry->status,
                    'reason' => $entry->reason,
                    'output' => $entry->output,
                    'error' => $entry->error,
                    'started_at' => $entry->started_at?->toISOString(),
                    'finished_at' => $entry->finished_at?->toISOString(),
                    'child_agent' => $child ? [
                        'uuid' => $child->uuid,
                        'name' => $child->name,
                        'type' => $child->type,
                        'avatar_color' => $child->avatar_color,
                    ] : null,
                    'child_run' => $childRun ? [
                        'uuid' => $childRun->uuid,
                        'status' => $childRun->status,
                        'summary' => $childRun->summary,
                    ] : null,
                ];
            })
            ->values()
            ->all();
    }
}
