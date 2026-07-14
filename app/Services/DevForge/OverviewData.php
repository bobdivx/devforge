<?php

namespace App\Services\DevForge;

use App\Models\AiAgent;
use App\Models\AiAgentRun;
use App\Models\Environment;
use App\Models\PrivateKey;
use App\Models\Project;
use App\Models\SharedEnvironmentVariable;
use App\Models\Team;
use Illuminate\Support\Facades\Schema;

class OverviewData
{
    public function __construct(
        private readonly ResourceData $resourceData,
        private readonly ResourceStatusData $resourceStatusData,
        private readonly DeploymentData $deploymentData,
        private readonly ResourceStatusClassifier $resourceStatusClassifier,
    ) {}

    /**
     * @return array<string, mixed>
     */
    public function build(Team $team): array
    {
        $projects = Project::query()->where('team_id', $team->id);
        $statuses = $this->resourceStatusData->build($team);
        $health = $this->summarizeHealth($statuses);

        $recentDeployments = $this->deploymentData
            ->paginate($team, 1, 5, null, null)
            ->getCollection()
            ->map(fn ($deployment): array => $this->deploymentData->deployment($deployment))
            ->values()
            ->all();

        return [
            'counts' => [
                'projects' => (clone $projects)->count(),
                'environments' => Environment::query()
                    ->whereHas('project', fn ($query) => $query->where('team_id', $team->id))
                    ->count(),
                'shared_variables' => SharedEnvironmentVariable::query()
                    ->where('team_id', $team->id)
                    ->count(),
                'private_keys' => PrivateKey::query()->where('team_id', $team->id)->count(),
                'members' => $team->members()->count(),
            ],
            'recent_projects' => $projects
                ->latest()
                ->limit(5)
                ->get()
                ->map(fn (Project $project): array => $this->resourceData->project($project))
                ->all(),
            'health' => $health,
            'resource_statuses' => $statuses,
            'recent_deployments' => $recentDeployments,
            'agent_activity' => $this->agentActivity($team),
            'agents_summary' => $this->agentsSummary($team),
        ];
    }

    /**
     * @param  array<string, array<int, array<string, mixed>>>  $statuses
     * @return array<string, int>
     */
    private function summarizeHealth(array $statuses): array
    {
        $all = collect($statuses)->flatMap(fn (array $items): array => $items)->values()->all();

        return $this->resourceStatusClassifier->summarize($all);
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    private function agentActivity(Team $team): array
    {
        if (! $this->agentsAvailable()) {
            return [];
        }

        return AiAgentRun::query()
            ->whereHas('agent', fn ($query) => $query->where('team_id', $team->id))
            ->latest()
            ->limit(5)
            ->with(['agent:id,uuid,name,type,avatar_color'])
            ->get()
            ->map(fn (AiAgentRun $run): array => [
                'uuid' => $run->uuid,
                'status' => $run->status,
                'trigger' => $run->trigger,
                'summary' => $run->summary,
                'created_at' => $run->created_at?->toISOString(),
                'agent' => $run->agent ? [
                    'uuid' => $run->agent->uuid,
                    'name' => $run->agent->name,
                    'type' => $run->agent->type,
                    'avatar_color' => $run->agent->avatar_color,
                ] : null,
            ])
            ->all();
    }

    /**
     * @return array<string, int>|null
     */
    private function agentsSummary(Team $team): ?array
    {
        if (! $this->agentsAvailable()) {
            return null;
        }

        return [
            'total' => AiAgent::query()->where('team_id', $team->id)->count(),
            'active' => AiAgent::query()->where('team_id', $team->id)->where('is_active', true)->count(),
            'running' => AiAgent::query()->where('team_id', $team->id)->where('status', 'running')->count(),
        ];
    }

    private function agentsAvailable(): bool
    {
        if (! config('devforge.agents_enabled', false)) {
            return false;
        }

        return Schema::hasTable('ai_agents') && Schema::hasTable('ai_agent_runs');
    }
}
