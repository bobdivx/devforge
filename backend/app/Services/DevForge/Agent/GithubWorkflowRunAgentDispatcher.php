<?php

namespace App\Services\DevForge\Agent;

use App\Models\AiAgent;
use App\Models\AiAgentRun;
use App\Models\GithubApp;
use App\Models\Team;
use Illuminate\Support\Facades\Log;

/**
 * Déclenche les agents type `github-actions` sur webhook GitHub workflow_run (échec).
 */
class GithubWorkflowRunAgentDispatcher
{
    public function __construct(
        private readonly AgentRunLauncher $agentRunLauncher,
    ) {}

    /**
     * @param  array<string, mixed>  $payload
     */
    public function dispatch(GithubApp $githubApp, array $payload): ?AiAgentRun
    {
        if (! config('devforge.agents_enabled')) {
            return null;
        }

        $action = strtolower((string) data_get($payload, 'action', ''));
        $conclusion = strtolower((string) data_get($payload, 'workflow_run.conclusion', ''));
        $status = strtolower((string) data_get($payload, 'workflow_run.status', ''));

        if ($action !== 'completed' || $status !== 'completed') {
            return null;
        }

        if (! in_array($conclusion, ['failure', 'timed_out', 'startup_failure'], true)) {
            return null;
        }

        $team = $githubApp->team;
        if (! $team instanceof Team) {
            return null;
        }

        $runId = (int) data_get($payload, 'workflow_run.id', 0);
        if ($runId <= 0) {
            return null;
        }

        if ($this->wasRecentlyHandled($team, $runId)) {
            return null;
        }

        $agent = AiAgent::query()
            ->where('team_id', $team->id)
            ->where('type', 'github-actions')
            ->where('is_active', true)
            ->whereNull('parent_agent_id')
            ->orderBy('id')
            ->first();

        if (! $agent instanceof AiAgent) {
            Log::info('DevForge: webhook workflow_run en échec sans agent github-actions.', [
                'team_id' => $team->id,
                'github_app_uuid' => $githubApp->uuid,
                'run_id' => $runId,
            ]);

            return null;
        }

        $context = $this->buildContext($githubApp, $payload, $runId);
        $run = $this->agentRunLauncher->queue($agent, 'event', $context);

        if ($run === null) {
            Log::warning('DevForge: agent github-actions déjà en cours, workflow_run ignoré.', [
                'agent_uuid' => $agent->uuid,
                'run_id' => $runId,
            ]);

            return null;
        }

        Log::info('DevForge: agent github-actions déclenché par workflow_run.', [
            'agent_uuid' => $agent->uuid,
            'run_uuid' => $run->uuid,
            'workflow_run_id' => $runId,
            'conclusion' => $conclusion,
        ]);

        return $run;
    }

    private function wasRecentlyHandled(Team $team, int $runId): bool
    {
        return AiAgentRun::query()
            ->where('trigger', 'event')
            ->where('created_at', '>=', now()->subHour())
            ->where('metadata->event', 'github_workflow_run_failed')
            ->where('metadata->workflow_run_id', $runId)
            ->where(function ($query): void {
                $query->whereIn('status', ['pending', 'running', 'completed', 'waiting_for_subagents', 'awaiting_approval'])
                    ->orWhere(function ($failed): void {
                        $failed->where('status', 'failed')->where('iterations', '>', 0);
                    });
            })
            ->whereHas('agent', fn ($query) => $query->where('team_id', $team->id))
            ->exists();
    }

    /**
     * @param  array<string, mixed>  $payload
     * @return array<string, mixed>
     */
    private function buildContext(GithubApp $githubApp, array $payload, int $runId): array
    {
        $fullName = (string) data_get($payload, 'repository.full_name', '');
        [$owner, $repo] = array_pad(explode('/', $fullName, 2), 2, '');

        return [
            'event' => 'github_workflow_run_failed',
            'github_app_uuid' => $githubApp->uuid,
            'workflow_run_id' => $runId,
            'workflow_id' => data_get($payload, 'workflow_run.workflow_id'),
            'workflow_name' => data_get($payload, 'workflow_run.name'),
            'workflow_path' => data_get($payload, 'workflow_run.path'),
            'conclusion' => data_get($payload, 'workflow_run.conclusion'),
            'status' => data_get($payload, 'workflow_run.status'),
            'head_branch' => data_get($payload, 'workflow_run.head_branch'),
            'head_sha' => data_get($payload, 'workflow_run.head_sha'),
            'html_url' => data_get($payload, 'workflow_run.html_url'),
            'owner' => $owner !== '' ? $owner : data_get($payload, 'repository.owner.login'),
            'repo' => $repo !== '' ? $repo : data_get($payload, 'repository.name'),
            'repository' => $fullName,
            'subagent_role' => \App\Services\DevForge\Agent\Tool\AgentSubagentCapabilities::ROLE_ORCHESTRATOR,
            'spawn_depth' => 0,
            'leaf_profile_hint' => \App\Services\DevForge\Agent\Tool\AgentSubagentCapabilities::PROFILE_FIX_CI,
        ];
    }
}
