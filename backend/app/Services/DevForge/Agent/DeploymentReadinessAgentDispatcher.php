<?php

namespace App\Services\DevForge\Agent;

use App\Models\AiAgent;
use App\Models\AiAgentRun;
use App\Models\Application;
use App\Models\ApplicationReadiness;
use App\Models\Team;
use Illuminate\Support\Facades\Log;

class DeploymentReadinessAgentDispatcher
{
    public const EVENT = 'application_readiness_failed';

    public function __construct(
        private readonly AgentRunLauncher $agentRunLauncher,
        private readonly DeploymentAgentResolver $agentResolver,
    ) {}

    /**
     * @param  array{ok: bool, url: string|null, status: int|null, error: string|null, skipped: bool}  $probeResult
     */
    public function dispatch(
        Application $application,
        ApplicationReadiness $readiness,
        array $probeResult,
    ): ?AiAgentRun {
        if (! config('devforge.agents_enabled') || ! (bool) config('devforge.readiness_enabled', true)) {
            return null;
        }

        $team = $this->agentResolver->resolveTeam($application);

        if (! $team instanceof Team) {
            Log::warning('DevForge readiness: équipe introuvable.', [
                'application_uuid' => $application->uuid,
            ]);

            return null;
        }

        if ($this->wasRecentlyHandled($team, $application->uuid, (int) $readiness->round)) {
            return null;
        }

        $agent = $this->agentResolver->resolve($team, $application->uuid, DeploymentAgentResolver::FAILURE_TYPES);

        if (! $agent instanceof AiAgent) {
            Log::warning('DevForge readiness: aucun agent éligible.', [
                'team_id' => $team->id,
                'application_uuid' => $application->uuid,
                'diagnostics' => $this->agentResolver->diagnostics($team, $application->uuid),
            ]);

            return null;
        }

        $context = [
            'event' => self::EVENT,
            'application_uuid' => $application->uuid,
            'application_name' => $application->name,
            'deployment_uuid' => $readiness->last_deployment_uuid,
            'fqdn' => $application->fqdn,
            'probe_url' => $probeResult['url'],
            'probe_status' => $probeResult['status'],
            'probe_error' => $probeResult['error'],
            'readiness_round' => $readiness->round,
            'readiness_max_rounds' => $readiness->max_rounds,
            'build_pack' => $application->build_pack ?: null,
            'publish_directory' => $application->publish_directory ?: null,
            'is_static' => (bool) ($application->settings?->is_static ?? false),
        ];

        $run = $this->agentRunLauncher->queue($agent, 'event', $context);

        if ($run === null) {
            Log::warning('DevForge readiness: agent indisponible (déjà en cours).', [
                'agent_uuid' => $agent->uuid,
                'application_uuid' => $application->uuid,
            ]);

            return null;
        }

        try {
            app(ApplicationOverviewChatBridge::class)->postFailureAnnouncement(
                $agent,
                $run,
                $application,
                $context,
            );
        } catch (\Throwable $e) {
            Log::warning('DevForge readiness: impossible de publier dans le chat overview.', [
                'application_uuid' => $application->uuid,
                'error' => $e->getMessage(),
            ]);
        }

        Log::info('DevForge readiness: agent déclenché après échec de probe.', [
            'agent_uuid' => $agent->uuid,
            'run_uuid' => $run->uuid,
            'application_uuid' => $application->uuid,
            'round' => $readiness->round,
        ]);

        return $run;
    }

    private function wasRecentlyHandled(Team $team, string $applicationUuid, int $round): bool
    {
        return AiAgentRun::query()
            ->where('trigger', 'event')
            ->where('created_at', '>=', now()->subMinutes(20))
            ->where('metadata->event', self::EVENT)
            ->where('metadata->application_uuid', $applicationUuid)
            ->where('metadata->readiness_round', $round)
            ->where(function ($query): void {
                $query->whereIn('status', ['pending', 'running', 'completed'])
                    ->orWhere(function ($failed): void {
                        $failed->where('status', 'failed')
                            ->where('iterations', '>', 0);
                    });
            })
            ->whereHas('agent', fn ($query) => $query->where('team_id', $team->id))
            ->exists();
    }
}
