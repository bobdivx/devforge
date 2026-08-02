<?php

namespace App\Services\DevForge\Agent;

use App\Models\AiAgent;
use App\Models\AiAgentMission;
use App\Models\Team;
use Carbon\Carbon;
use Illuminate\Support\Facades\Log;

/**
 * Claim les missions open et lance un run sur l'agent assignee (équipe autonome).
 */
class MissionWorkDispatcher
{
    public function __construct(
        private readonly AgentMissionBoard $missionBoard,
        private readonly AgentRunLauncher $agentRunLauncher,
    ) {}

    /**
     * @return array{checked: int, claimed: int, runs: int, skipped: int}
     */
    public function dispatchDue(int $limit = 10): array
    {
        if (! config('devforge.agents_enabled')) {
            return ['checked' => 0, 'claimed' => 0, 'runs' => 0, 'skipped' => 0];
        }

        if (! $this->missionBoard->available()) {
            return ['checked' => 0, 'claimed' => 0, 'runs' => 0, 'skipped' => 0];
        }

        $cooldownMinutes = max(1, (int) config('devforge.agents_mission_work_cooldown_minutes', 10));
        $limit = max(1, min($limit, 25));

        $missions = AiAgentMission::query()
            ->where('status', 'open')
            ->orderByRaw("CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END")
            ->orderBy('updated_at')
            ->limit($limit * 3)
            ->get();

        $checked = 0;
        $claimed = 0;
        $runs = 0;
        $skipped = 0;

        foreach ($missions as $mission) {
            if ($checked >= $limit) {
                break;
            }

            $checked++;

            $metadata = is_array($mission->metadata) ? $mission->metadata : [];
            $lastDispatched = $metadata['last_dispatched_at'] ?? null;
            if (is_string($lastDispatched) && $lastDispatched !== '') {
                try {
                    if (Carbon::parse($lastDispatched)->greaterThan(now()->subMinutes($cooldownMinutes))) {
                        $skipped++;

                        continue;
                    }
                } catch (\Throwable) {
                    // ignore parse errors
                }
            }

            $team = Team::query()->find($mission->team_id);
            if (! $team instanceof Team) {
                $skipped++;

                continue;
            }

            $worker = $this->resolveWorker($team, $mission);
            if (! $worker instanceof AiAgent) {
                $skipped++;

                continue;
            }

            if (! $worker->hasLlmProvider() || $worker->status === 'running') {
                $skipped++;

                continue;
            }

            $claimedMission = $this->missionBoard->claim($team, $mission->uuid, $worker);
            if (! $claimedMission instanceof AiAgentMission) {
                $skipped++;

                continue;
            }

            $claimed++;

            $run = $this->agentRunLauncher->queue($worker, 'event', [
                'event' => 'mission_work',
                'mission_uuid' => $claimedMission->uuid,
                'mission_kind' => $claimedMission->kind,
                'mission_title' => $claimedMission->title,
                'application_uuid' => $claimedMission->resource_uuid,
                'resource_uuid' => $claimedMission->resource_uuid,
            ]);

            $meta = is_array($claimedMission->metadata) ? $claimedMission->metadata : [];
            $meta['last_dispatched_at'] = now()->toISOString();
            if ($run !== null) {
                $meta['run_uuid'] = $run->uuid;
                $runs++;
            }

            $claimedMission->update(['metadata' => $meta]);

            Log::info('DevForge: mission_work dispatched.', [
                'mission_uuid' => $claimedMission->uuid,
                'agent_uuid' => $worker->uuid,
                'run_uuid' => $run?->uuid,
            ]);
        }

        return compact('checked', 'claimed', 'runs', 'skipped');
    }

    private function resolveWorker(Team $team, AiAgentMission $mission): ?AiAgent
    {
        if ($mission->assignee_agent_id !== null) {
            $agent = AiAgent::query()
                ->where('team_id', $team->id)
                ->whereKey($mission->assignee_agent_id)
                ->where('is_active', true)
                ->first();

            if ($agent instanceof AiAgent) {
                return $agent;
            }
        }

        $metadata = is_array($mission->metadata) ? $mission->metadata : [];
        $type = is_string($metadata['assignee_type'] ?? null) && $metadata['assignee_type'] !== ''
            ? $metadata['assignee_type']
            : $this->missionBoard->defaultAssigneeTypeForKind((string) $mission->kind);

        return $this->missionBoard->findAgentByType($team, $type);
    }
}
