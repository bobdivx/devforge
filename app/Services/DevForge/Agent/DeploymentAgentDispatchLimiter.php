<?php

namespace App\Services\DevForge\Agent;

use App\Models\AiAgentRun;
use App\Models\Team;
use Illuminate\Support\Facades\Log;

/**
 * Limite les runs d'agents par déploiement pour préserver le quota LLM (ex. Gemini free tier).
 */
class DeploymentAgentDispatchLimiter
{
    public const EVENT_FAILED = 'deployment_failed';

    public const EVENT_BUILD_STARTED = 'deployment_build_started';

    public const EVENT_BUILD_COMPLETED = 'deployment_build_completed';

    public function allows(string $event, Team $team, string $deploymentUuid): bool
    {
        $max = (int) config('devforge.agents_per_deployment_max_runs', 1);

        if ($max <= 0) {
            return true;
        }

        if (! in_array($event, $this->allowedEventsForLimit($max), true)) {
            Log::debug('DevForge: événement agent ignoré (limite quota par déploiement).', [
                'event' => $event,
                'deployment_uuid' => $deploymentUuid,
                'max_runs' => $max,
                'team_id' => $team->id,
            ]);

            return false;
        }

        $count = $this->countRunsForDeployment($team, $deploymentUuid);

        if ($count >= $max) {
            Log::debug('DevForge: limite de runs agents atteinte pour ce déploiement.', [
                'event' => $event,
                'deployment_uuid' => $deploymentUuid,
                'max_runs' => $max,
                'existing_runs' => $count,
                'team_id' => $team->id,
            ]);

            return false;
        }

        return true;
    }

    /** @return array<int, string> */
    public function allowedEventsForLimit(int $max): array
    {
        return match (true) {
            $max === 1 => [self::EVENT_FAILED],
            $max === 2 => [self::EVENT_FAILED, self::EVENT_BUILD_STARTED],
            default => [
                self::EVENT_FAILED,
                self::EVENT_BUILD_STARTED,
                self::EVENT_BUILD_COMPLETED,
            ],
        };
    }

    public function countRunsForDeployment(Team $team, string $deploymentUuid): int
    {
        return AiAgentRun::query()
            ->where('trigger', 'event')
            ->where('created_at', '>=', now()->subDay())
            ->where(function ($query) use ($deploymentUuid): void {
                $query->where('logs', 'like', '%"deployment_uuid":"'.$deploymentUuid.'"%')
                    ->orWhere('metadata->deployment_uuid', $deploymentUuid);
            })
            ->whereHas('agent', fn ($query) => $query->where('team_id', $team->id))
            ->count();
    }
}
