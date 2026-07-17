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

    /**
     * Politique de dispatch exposée au monitoring UI (quota vs monitor_build).
     *
     * @return array{
     *     max_runs_per_deployment: int,
     *     monitor_build_enabled: bool,
     *     auto_fix_deployments: bool,
     *     allowed_events: list<string>,
     *     skipped_events: list<array{event: string, reason: string, detail?: string}>,
     *     build_monitoring_effective: bool,
     *     summary: string|null
     * }
     */
    public function policy(): array
    {
        $max = (int) config('devforge.agents_per_deployment_max_runs', 1);
        $monitorBuild = (bool) config('devforge.agents_monitor_build_enabled', true);
        $autoFix = (bool) config('devforge.agents_auto_fix_deployments', true);
        $allEvents = [
            self::EVENT_FAILED,
            self::EVENT_BUILD_STARTED,
            self::EVENT_BUILD_COMPLETED,
        ];
        $allowedByQuota = $max <= 0 ? $allEvents : $this->allowedEventsForLimit($max);

        $allowed = [];
        $skipped = [];

        foreach ($allEvents as $event) {
            if ($event === self::EVENT_FAILED && ! $autoFix) {
                $skipped[] = [
                    'event' => $event,
                    'reason' => 'auto_fix_disabled',
                ];

                continue;
            }

            if (
                in_array($event, [self::EVENT_BUILD_STARTED, self::EVENT_BUILD_COMPLETED], true)
                && ! $monitorBuild
            ) {
                $skipped[] = [
                    'event' => $event,
                    'reason' => 'monitor_build_disabled',
                ];

                continue;
            }

            if ($max > 0 && ! in_array($event, $allowedByQuota, true)) {
                $skipped[] = [
                    'event' => $event,
                    'reason' => 'quota_max_runs',
                    'detail' => 'agents_per_deployment_max_runs='.$max,
                ];

                continue;
            }

            $allowed[] = $event;
        }

        $buildEventsAllowed = array_intersect(
            [self::EVENT_BUILD_STARTED, self::EVENT_BUILD_COMPLETED],
            $allowed,
        ) !== [];

        $buildMonitoringEffective = $monitorBuild && $buildEventsAllowed;

        return [
            'max_runs_per_deployment' => $max,
            'monitor_build_enabled' => $monitorBuild,
            'auto_fix_deployments' => $autoFix,
            'allowed_events' => array_values($allowed),
            'skipped_events' => $skipped,
            'build_monitoring_effective' => $buildMonitoringEffective,
            'summary' => $this->policySummary(
                max: $max,
                monitorBuild: $monitorBuild,
                buildMonitoringEffective: $buildMonitoringEffective,
            ),
        ];
    }

    public function countRunsForDeployment(Team $team, string $deploymentUuid): int
    {
        return AiAgentRun::query()
            ->where('trigger', 'event')
            ->where('created_at', '>=', now()->subDay())
            ->where(function ($query) use ($deploymentUuid): void {
                // Préférer metadata (index JSON) ; LIKE logs pour les anciens runs.
                $query->where('metadata->deployment_uuid', $deploymentUuid)
                    ->orWhere('logs', 'like', '%"deployment_uuid":"'.$deploymentUuid.'"%');
            })
            // Les runs morts avant la 1re itération ne consomment pas le quota LLM.
            ->where(function ($query): void {
                $query->whereIn('status', ['pending', 'running', 'completed'])
                    ->orWhere(function ($failed): void {
                        $failed->where('status', 'failed')
                            ->where('iterations', '>', 0);
                    });
            })
            ->whereHas('agent', fn ($query) => $query->where('team_id', $team->id))
            ->count();
    }

    private function policySummary(int $max, bool $monitorBuild, bool $buildMonitoringEffective): ?string
    {
        if ($monitorBuild && ! $buildMonitoringEffective && $max === 1) {
            return 'La surveillance des builds est activée, mais le quota (1 run/déploiement) ne déclenche un agent qu’en cas d’échec. Augmentez DEVFORGE_AGENTS_PER_DEPLOYMENT_MAX_RUNS à 2+ pour surveiller aussi les builds.';
        }

        if ($monitorBuild && ! $buildMonitoringEffective && $max === 2) {
            return 'La surveillance des builds est partielle : avec un quota de 2 runs/déploiement, seul le début de build est autorisé (pas la fin).';
        }

        return null;
    }
}
