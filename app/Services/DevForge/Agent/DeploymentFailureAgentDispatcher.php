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
    ) {}

    public function dispatch(
        Application $application,
        string $deploymentUuid,
        ApplicationDeploymentQueue $deploymentQueue,
    ): void {
        if (! config('devforge.agents_enabled') || ! config('devforge.agents_auto_fix_deployments')) {
            return;
        }

        $team = $application->environment?->project?->team;

        if (! $team instanceof Team) {
            return;
        }

        if ($this->wasRecentlyHandled($team, $deploymentUuid)) {
            return;
        }

        $agent = $this->resolveAgent($team, $application->uuid);

        if (! $agent instanceof AiAgent) {
            Log::info('DevForge: aucun agent actif pour traiter l\'échec de déploiement.', [
                'team_id' => $team->id,
                'application_uuid' => $application->uuid,
                'deployment_uuid' => $deploymentUuid,
            ]);

            return;
        }

        $context = $this->buildContext($application, $deploymentUuid, $deploymentQueue);

        $this->agentRunLauncher->queue($agent, 'event', $context);

        Log::info('DevForge: agent IA déclenché après échec de déploiement.', [
            'agent_uuid' => $agent->uuid,
            'application_uuid' => $application->uuid,
            'deployment_uuid' => $deploymentUuid,
        ]);
    }

    private function resolveAgent(Team $team, string $applicationUuid): ?AiAgent
    {
        return AiAgent::query()
            ->where('team_id', $team->id)
            ->whereIn('type', ['deployment', 'debug', 'devforge'])
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

        $score = match ($agent->type) {
            'deployment' => 100,
            'devforge' => 95,
            'debug' => 50,
            default => 0,
        };

        if ($agent->resource_uuid === $applicationUuid) {
            $score += 50;
        } elseif ($agent->resource_uuid === null || $agent->resource_uuid === '') {
            $score += 10;
        }

        return $score;
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
