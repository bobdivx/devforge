<?php

namespace App\Services\DevForge\Agent;

use App\Models\AiAgent;
use App\Models\AiAgentRun;
use App\Models\Application;
use App\Models\ApplicationDeploymentQueue;
use App\Models\Team;
use App\Services\DevForge\Agent\AgentRunLauncher;
use Illuminate\Support\Facades\Log;

class DeploymentBuildAgentDispatcher
{
    private const CONTEXT_MARKER = 'deployment_uuid';

    private const EVENT_BUILD_STARTED = 'deployment_build_started';

    private const EVENT_BUILD_COMPLETED = 'deployment_build_completed';

    public function __construct(private readonly AgentRunLauncher $agentRunLauncher) {}

    public function dispatch(
        Application $application,
        string $deploymentUuid,
        ApplicationDeploymentQueue $deploymentQueue,
    ): void {
        $this->dispatchEvent(
            application: $application,
            deploymentUuid: $deploymentUuid,
            deploymentQueue: $deploymentQueue,
            event: self::EVENT_BUILD_STARTED,
        );
    }

    public function dispatchCompleted(
        Application $application,
        string $deploymentUuid,
        ApplicationDeploymentQueue $deploymentQueue,
    ): void {
        $this->dispatchEvent(
            application: $application,
            deploymentUuid: $deploymentUuid,
            deploymentQueue: $deploymentQueue,
            event: self::EVENT_BUILD_COMPLETED,
        );
    }

    private function dispatchEvent(
        Application $application,
        string $deploymentUuid,
        ApplicationDeploymentQueue $deploymentQueue,
        string $event,
    ): void {
        if (! config('devforge.agents_enabled') || ! config('devforge.agents_monitor_build_enabled', true)) {
            return;
        }

        if ($deploymentQueue->restart_only) {
            return;
        }

        $team = $application->environment?->project?->team;

        if (! $team instanceof Team) {
            return;
        }

        if ($this->wasRecentlyHandled($team, $deploymentUuid, $event)) {
            return;
        }

        $agent = $this->resolveAgent($team, $application->uuid);

        if (! $agent instanceof AiAgent) {
            Log::info('DevForge: aucun agent DevForge actif pour surveiller le déploiement.', [
                'team_id' => $team->id,
                'application_uuid' => $application->uuid,
                'deployment_uuid' => $deploymentUuid,
                'event' => $event,
            ]);

            return;
        }

        $context = $this->buildContext($application, $deploymentUuid, $deploymentQueue, $event);

        $this->agentRunLauncher->queue($agent, 'event', $context);

        Log::info('DevForge: agent DevForge déclenché pour le déploiement.', [
            'agent_uuid' => $agent->uuid,
            'application_uuid' => $application->uuid,
            'deployment_uuid' => $deploymentUuid,
            'event' => $event,
        ]);
    }

    private function resolveAgent(Team $team, string $applicationUuid): ?AiAgent
    {
        return AiAgent::query()
            ->where('team_id', $team->id)
            ->where('type', 'devforge')
            ->where('is_active', true)
            ->where('status', '!=', 'running')
            ->get()
            ->filter(fn (AiAgent $agent): bool => $agent->hasLlmProvider() && $this->agentScore($agent, $applicationUuid) >= 0)
            ->sortByDesc(fn (AiAgent $agent): int => $this->agentScore($agent, $applicationUuid))
            ->first();
    }

    private function agentScore(AiAgent $agent, string $applicationUuid): int
    {
        if ($agent->resource_uuid !== null && $agent->resource_uuid !== '' && $agent->resource_uuid !== $applicationUuid) {
            return -1;
        }

        $score = 100;

        if ($agent->resource_uuid === $applicationUuid) {
            $score += 50;
        } elseif ($agent->resource_uuid === null || $agent->resource_uuid === '') {
            $score += 10;
        }

        return $score;
    }

    private function wasRecentlyHandled(Team $team, string $deploymentUuid, string $event): bool
    {
        return AiAgentRun::query()
            ->where('trigger', 'event')
            ->where('created_at', '>=', now()->subHour())
            ->where('logs', 'like', '%"'.self::CONTEXT_MARKER.'":"'.$deploymentUuid.'"%')
            ->where('logs', 'like', '%"event":"'.$event.'"%')
            ->whereHas('agent', fn ($query) => $query->where('team_id', $team->id)->where('type', 'devforge'))
            ->exists();
    }

    /**
     * @return array<string, mixed>
     */
    private function buildContext(
        Application $application,
        string $deploymentUuid,
        ApplicationDeploymentQueue $deploymentQueue,
        string $event,
    ): array {
        return [
            'event' => $event,
            self::CONTEXT_MARKER => $deploymentUuid,
            'application_uuid' => $application->uuid,
            'application_name' => $application->name,
            'commit' => $deploymentQueue->commit ?: null,
            'commit_message' => $deploymentQueue->commit_message ?: null,
            'is_webhook' => (bool) $deploymentQueue->is_webhook,
            'trigger_source' => $deploymentQueue->is_webhook ? 'webhook' : 'manual',
            'build_pack' => $application->build_pack,
            'status' => $deploymentQueue->status,
        ];
    }
}
