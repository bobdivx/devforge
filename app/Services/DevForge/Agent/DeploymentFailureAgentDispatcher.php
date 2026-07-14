<?php

namespace App\Services\DevForge\Agent;

use App\Models\AiAgent;
use App\Models\AiAgentRun;
use App\Models\Application;
use App\Models\ApplicationDeploymentQueue;
use App\Models\Team;
use App\Services\DevForge\DeploymentData;
use Illuminate\Support\Facades\Log;

class DeploymentFailureAgentDispatcher
{
    private const CONTEXT_MARKER = 'deployment_uuid';

    public function __construct(
        private readonly DeploymentData $deploymentData,
        private readonly AgentRunLauncher $agentRunLauncher,
        private readonly DeploymentAgentResolver $agentResolver,
        private readonly DeploymentAgentDispatchLimiter $dispatchLimiter,
    ) {}

    public function dispatch(
        Application $application,
        string $deploymentUuid,
        ApplicationDeploymentQueue $deploymentQueue,
    ): ?AiAgentRun {
        if (! config('devforge.agents_enabled') || ! config('devforge.agents_auto_fix_deployments')) {
            return null;
        }

        $team = $this->agentResolver->resolveTeam($application);

        if (! $team instanceof Team) {
            Log::warning('DevForge: impossible de résoudre l\'équipe pour l\'échec de déploiement.', [
                'application_uuid' => $application->uuid,
                'deployment_uuid' => $deploymentUuid,
            ]);

            return null;
        }

        if ($this->wasRecentlyHandled($team, $deploymentUuid)) {
            return null;
        }

        if (! $this->dispatchLimiter->allows(DeploymentAgentDispatchLimiter::EVENT_FAILED, $team, $deploymentUuid)) {
            return null;
        }

        $agent = $this->agentResolver->resolve($team, $application->uuid, DeploymentAgentResolver::FAILURE_TYPES);

        if (! $agent instanceof AiAgent) {
            Log::warning('DevForge: aucun agent éligible pour traiter l\'échec de déploiement.', [
                'team_id' => $team->id,
                'application_uuid' => $application->uuid,
                'deployment_uuid' => $deploymentUuid,
                'diagnostics' => $this->agentResolver->diagnostics($team, $application->uuid),
            ]);

            return null;
        }

        $context = $this->buildContext($application, $deploymentUuid, $deploymentQueue);

        $run = $this->agentRunLauncher->queue($agent, 'event', $context);

        if ($run === null) {
            Log::warning('DevForge: agent trouvé mais indisponible pour l\'échec (déjà en cours).', [
                'agent_uuid' => $agent->uuid,
                'deployment_uuid' => $deploymentUuid,
            ]);

            return null;
        }

        Log::info('DevForge: agent IA déclenché après échec de déploiement.', [
            'agent_uuid' => $agent->uuid,
            'run_uuid' => $run->uuid,
            'application_uuid' => $application->uuid,
            'deployment_uuid' => $deploymentUuid,
        ]);

        return $run;
    }

    private function wasRecentlyHandled(Team $team, string $deploymentUuid): bool
    {
        return AiAgentRun::query()
            ->where('trigger', 'event')
            ->where('created_at', '>=', now()->subHour())
            ->where('logs', 'like', '%"'.self::CONTEXT_MARKER.'":"'.$deploymentUuid.'"%')
            ->where('logs', 'like', '%"event":"deployment_failed"%')
            ->whereHas('agent', fn ($query) => $query->where('team_id', $team->id))
            ->exists();
    }

    /**
     * @return array<string, mixed>
     */
    private function buildContext(
        Application $application,
        string $deploymentUuid,
        ApplicationDeploymentQueue $deploymentQueue,
    ): array {
        $logExcerpt = $this->extractFailureLogExcerpt($deploymentQueue);

        return [
            'event' => 'deployment_failed',
            self::CONTEXT_MARKER => $deploymentUuid,
            'application_uuid' => $application->uuid,
            'application_name' => $application->name,
            'commit' => $deploymentQueue->commit ?: null,
            'commit_message' => $deploymentQueue->commit_message ?: null,
            'status' => $deploymentQueue->status,
            'failure_excerpt' => $logExcerpt,
        ];
    }

    /**
     * @return array<int, array{stream: string, message: string, timestamp: string|null}>
     */
    private function extractFailureLogExcerpt(ApplicationDeploymentQueue $deploymentQueue, int $maxLines = 40): array
    {
        $payload = $this->deploymentData->logs($deploymentQueue, 0);
        $lines = collect($payload['items'] ?? []);

        $stderrLines = $lines
            ->filter(fn (array $line): bool => ($line['stream'] ?? '') === 'stderr')
            ->values();

        $selected = $stderrLines->isNotEmpty()
            ? $stderrLines->take(-$maxLines)
            : $lines->take(-$maxLines);

        return $selected
            ->map(fn (array $line): array => [
                'stream' => (string) ($line['stream'] ?? 'stdout'),
                'message' => (string) ($line['message'] ?? ''),
                'timestamp' => isset($line['timestamp']) ? (string) $line['timestamp'] : null,
            ])
            ->values()
            ->all();
    }
}
