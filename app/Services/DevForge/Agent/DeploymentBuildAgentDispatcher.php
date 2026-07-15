<?php

namespace App\Services\DevForge\Agent;

use App\Models\AiAgent;
use App\Models\AiAgentRun;
use App\Models\Application;
use App\Models\ApplicationDeploymentQueue;
use App\Models\Team;
use Illuminate\Support\Facades\Log;

class DeploymentBuildAgentDispatcher
{
    private const CONTEXT_MARKER = 'deployment_uuid';

    private const EVENT_BUILD_STARTED = 'deployment_build_started';

    private const EVENT_BUILD_COMPLETED = 'deployment_build_completed';

    public function __construct(
        private readonly AgentRunLauncher $agentRunLauncher,
        private readonly DeploymentAgentResolver $agentResolver,
        private readonly DeploymentAgentDispatchLimiter $dispatchLimiter,
    ) {}

    public function dispatch(
        Application $application,
        string $deploymentUuid,
        ApplicationDeploymentQueue $deploymentQueue,
    ): ?AiAgentRun {
        return $this->dispatchEvent(
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
    ): ?AiAgentRun {
        return $this->dispatchEvent(
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
    ): ?AiAgentRun {
        if (! config('devforge.agents_enabled') || ! config('devforge.agents_monitor_build_enabled', true)) {
            return null;
        }

        if ($deploymentQueue->restart_only) {
            return null;
        }

        $team = $this->agentResolver->resolveTeam($application);

        if (! $team instanceof Team) {
            Log::warning('DevForge: impossible de résoudre l\'équipe pour la surveillance du déploiement.', [
                'application_uuid' => $application->uuid,
                'deployment_uuid' => $deploymentUuid,
                'event' => $event,
            ]);

            return null;
        }

        if ($this->wasRecentlyHandled($team, $deploymentUuid, $event)) {
            return null;
        }

        if (! $this->dispatchLimiter->allows($event, $team, $deploymentUuid)) {
            return null;
        }

        $agent = $this->agentResolver->resolve($team, $application->uuid, DeploymentAgentResolver::BUILD_TYPES);

        if (! $agent instanceof AiAgent) {
            Log::warning('DevForge: aucun agent éligible pour surveiller le déploiement.', [
                'team_id' => $team->id,
                'application_uuid' => $application->uuid,
                'deployment_uuid' => $deploymentUuid,
                'event' => $event,
                'diagnostics' => $this->agentResolver->diagnostics($team, $application->uuid),
            ]);

            return null;
        }

        $context = $this->buildContext($application, $deploymentUuid, $deploymentQueue, $event);

        $run = $this->agentRunLauncher->queue($agent, 'event', $context);

        if ($run === null) {
            Log::warning('DevForge: agent trouvé mais indisponible (déjà en cours).', [
                'agent_uuid' => $agent->uuid,
                'deployment_uuid' => $deploymentUuid,
                'event' => $event,
            ]);

            return null;
        }

        Log::info('DevForge: agent IA déclenché pour la surveillance du déploiement.', [
            'agent_uuid' => $agent->uuid,
            'run_uuid' => $run->uuid,
            'application_uuid' => $application->uuid,
            'deployment_uuid' => $deploymentUuid,
            'event' => $event,
        ]);

        return $run;
    }

    private function wasRecentlyHandled(Team $team, string $deploymentUuid, string $event): bool
    {
        return AiAgentRun::query()
            ->where('trigger', 'event')
            ->where('created_at', '>=', now()->subHour())
            ->where(function ($query) use ($deploymentUuid): void {
                $query->where('logs', 'like', '%"'.self::CONTEXT_MARKER.'":"'.$deploymentUuid.'"%')
                    ->orWhere('metadata->deployment_uuid', $deploymentUuid);
            })
            ->where('logs', 'like', '%"event":"'.$event.'"%')
            ->whereHas('agent', fn ($query) => $query
                ->where('team_id', $team->id)
                ->whereIn('type', DeploymentAgentResolver::BUILD_TYPES))
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
