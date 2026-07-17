<?php

namespace App\Services\DevForge;

use App\Models\AiAgentRun;
use App\Models\AiAgentSubagentRun;
use App\Models\ApplicationDeploymentQueue;
use App\Models\Team;
use App\Services\DevForge\Agent\AgentRunCorrectionSummarizer;
use App\Services\DevForge\Agent\DeploymentAgentCatchUp;
use App\Services\DevForge\Agent\DeploymentAgentDispatchLimiter;
use App\Services\DevForge\Agent\DeploymentAgentResolver;
use Illuminate\Support\Collection;

class DeploymentMonitoringData
{
    private const CONTEXT_PREFIX = 'Contexte événement: ';

    /** @var array<int, string> */
    private array $runLinkage = [];

    public function __construct(
        private readonly DeploymentData $deploymentData,
        private readonly DeploymentAgentResolver $agentResolver,
        private readonly DeploymentAgentCatchUp $agentCatchUp,
        private readonly DeploymentAgentDispatchLimiter $dispatchLimiter,
        private readonly AgentRunCorrectionSummarizer $correctionSummarizer,
    ) {}

    /**
     * @return array<string, mixed>
     */
    public function forDeployment(Team $team, ApplicationDeploymentQueue $deployment): array
    {
        $deploymentUuid = (string) $deployment->deployment_uuid;
        $this->runLinkage = [];

        $runs = $this->findRunsForDeployment($team, $deploymentUuid, $deployment);
        $catchUpTriggered = false;

        if ($runs->isEmpty()) {
            $catchUpTriggered = $this->agentCatchUp->maybeDispatch($deployment);

            $runs = $this->findRunsForDeployment($team, $deploymentUuid, $deployment);
        }

        $applicationUuid = $deployment->application?->uuid;
        $diagnostics = $this->agentResolver->diagnostics($team, is_string($applicationUuid) ? $applicationUuid : null);

        return [
            'deployment' => $this->deploymentData->deployment($deployment),
            'agent_runs' => $runs
                ->map(fn (AiAgentRun $run): array => $this->presentAgentRun($run, $deploymentUuid, (string) $deployment->status))
                ->values()
                ->all(),
            'redeployments' => $this->resolveRedeployments($team, $runs),
            'agents' => [
                'enabled' => (bool) config('devforge.agents_enabled'),
                'auto_fix_deployments' => (bool) config('devforge.agents_auto_fix_deployments'),
                'monitor_build' => (bool) config('devforge.agents_monitor_build_enabled'),
                'webhook_build' => (bool) config('devforge.agents_monitor_build_enabled'),
            ],
            'dispatch_policy' => $this->dispatchLimiter->policy(),
            'diagnostics' => $diagnostics,
            'catch_up_triggered' => $catchUpTriggered,
        ];
    }

    /**
     * @return Collection<int, AiAgentRun>
     */
    private function findRunsForDeployment(Team $team, string $deploymentUuid, ApplicationDeploymentQueue $deployment): Collection
    {
        // queryDirectDeploymentRuns renseigne déjà linkage (metadata | logs).
        $direct = $this->queryDirectDeploymentRuns($team, $deploymentUuid);

        if ($direct->isNotEmpty()) {
            return $direct;
        }

        // Déploiement réussi / terminé : ne pas rattacher un run d'échec précédent via la fenêtre temporelle.
        if ($this->deploymentLooksSuccessful((string) $deployment->status)) {
            return collect();
        }

        $contextual = $this->findContextualRunsForDeployment($team, $deployment);

        foreach ($contextual as $run) {
            $this->runLinkage[$run->id] = 'context';
        }

        return $contextual;
    }

    /**
     * @return Collection<int, AiAgentRun>
     */
    private function queryDirectDeploymentRuns(Team $team, string $deploymentUuid): Collection
    {
        $byMetadata = AiAgentRun::query()
            ->with('agent')
            ->where('metadata->deployment_uuid', $deploymentUuid)
            ->whereHas('agent', fn ($query) => $query->where('team_id', $team->id))
            ->latest()
            ->limit(10)
            ->get();

        if ($byMetadata->isNotEmpty()) {
            foreach ($byMetadata as $run) {
                $this->runLinkage[$run->id] = 'metadata';
            }

            return $byMetadata;
        }

        $byLogs = AiAgentRun::query()
            ->with('agent')
            ->where(function ($query) use ($deploymentUuid): void {
                // Anciens runs : contexte dans les logs / actions (fallback).
                $query->where('logs', 'like', '%"deployment_uuid":"'.$deploymentUuid.'"%')
                    ->orWhere('logs', 'like', '%"deployment_uuid": "'.$deploymentUuid.'"%')
                    ->orWhere('actions_taken', 'like', '%'.$deploymentUuid.'%')
                    ->orWhere('logs', 'like', '%'.$deploymentUuid.'%');
            })
            ->whereHas('agent', fn ($query) => $query->where('team_id', $team->id))
            ->latest()
            ->limit(10)
            ->get();

        foreach ($byLogs as $run) {
            $this->runLinkage[$run->id] = 'logs';
        }

        return $byLogs;
    }

    /**
     * @return Collection<int, AiAgentRun>
     */
    private function findContextualRunsForDeployment(Team $team, ApplicationDeploymentQueue $deployment): Collection
    {
        $applicationUuid = $deployment->application?->uuid;

        if (! is_string($applicationUuid) || $applicationUuid === '') {
            return collect();
        }

        $deploymentUuid = (string) $deployment->deployment_uuid;
        $windowStart = ($deployment->created_at ?? now())->copy()->subMinutes(10);
        $windowEnd = ($deployment->finished_at ?? $deployment->updated_at ?? now())->copy()->addHour();

        return AiAgentRun::query()
            ->with('agent')
            ->whereIn('trigger', ['event', 'manual'])
            ->whereBetween('created_at', [$windowStart, $windowEnd])
            ->whereHas('agent', function ($query) use ($team, $applicationUuid): void {
                $query->where('team_id', $team->id)
                    ->where(function ($scoped) use ($applicationUuid): void {
                        $scoped->whereNull('resource_uuid')
                            ->orWhere('resource_uuid', '')
                            ->orWhere('resource_uuid', $applicationUuid);
                    });
            })
            // Empêche d'afficher le run d'une autre app (agent équipe) dans la même fenêtre temporelle.
            ->where(function ($query) use ($applicationUuid, $deploymentUuid): void {
                $query->where('metadata->application_uuid', $applicationUuid)
                    ->orWhere('metadata->deployment_uuid', $deploymentUuid)
                    ->orWhere('logs', 'like', '%'.$applicationUuid.'%')
                    ->orWhere('logs', 'like', '%'.$deploymentUuid.'%')
                    ->orWhereHas('agent', fn ($agentQuery) => $agentQuery->where('resource_uuid', $applicationUuid));
            })
            ->latest()
            ->limit(5)
            ->get();
    }

    /**
     * @return array<string, mixed>
     */
    private function presentAgentRun(AiAgentRun $run, string $focusedDeploymentUuid, string $deploymentStatus): array
    {
        $agent = $run->agent;
        $metadata = $run->metadata ?? [];
        $correction = is_array($metadata['correction'] ?? null)
            ? $metadata['correction']
            : $this->correctionSummarizer->summarize($run);

        $belongsTo = is_string($correction['belongs_to_deployment_uuid'] ?? null)
            ? $correction['belongs_to_deployment_uuid']
            : null;
        $historicalForOtherAttempt = is_string($belongsTo)
            && $belongsTo !== ''
            && $belongsTo !== $focusedDeploymentUuid;

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
            'metadata' => $metadata,
            'correction' => $correction,
            'historical_for_other_attempt' => $historicalForOtherAttempt,
            'subagent_runs' => $this->presentSubagentRuns($run),
            // Logs bruts toujours disponibles ; l'UI les plie par défaut.
            'logs' => $run->logs,
            'linkage' => $this->runLinkage[$run->id] ?? 'metadata',
            'agent' => $agent ? [
                'uuid' => $agent->uuid,
                'name' => $agent->name,
                'type' => $agent->type,
                'avatar_color' => $agent->avatar_color,
            ] : null,
            'focused_deployment_status' => $deploymentStatus,
        ];
    }

    private function deploymentLooksSuccessful(string $status): bool
    {
        $normalized = strtolower(trim($status));

        return str_contains($normalized, 'finish')
            || str_contains($normalized, 'success')
            || $normalized === 'completed'
            || $normalized === 'done';
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
