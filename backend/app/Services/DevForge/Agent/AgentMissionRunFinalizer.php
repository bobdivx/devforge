<?php

namespace App\Services\DevForge\Agent;

use App\Models\AiAgentMission;
use App\Models\AiAgentRun;
use App\Models\Team;

/**
 * Clôture les missions laissées en in_progress quand le run associé se termine
 * sans mission_update explicite (claims fantômes).
 */
class AgentMissionRunFinalizer
{
    public function __construct(
        private readonly AgentMissionBoard $missionBoard,
        private readonly AgentFeatureDelivery $featureDelivery,
    ) {}

    public function finalizeFromRun(AiAgentRun $run): void
    {
        if (! $this->missionBoard->available()) {
            return;
        }

        $metadata = is_array($run->metadata) ? $run->metadata : [];
        $missionUuid = is_string($metadata['mission_uuid'] ?? null)
            ? trim((string) $metadata['mission_uuid'])
            : '';

        if ($missionUuid === '') {
            return;
        }

        if (in_array($run->status, ['pending', 'running', 'waiting_for_subagents', 'waiting_for_input', 'awaiting_approval'], true)) {
            return;
        }

        $mission = AiAgentMission::query()
            ->where('uuid', $missionUuid)
            ->first();

        if (! $mission instanceof AiAgentMission || $mission->status !== 'in_progress') {
            return;
        }

        $team = Team::query()->find($mission->team_id);
        if (! $team instanceof Team) {
            return;
        }

        if ($run->status === 'completed') {
            if ($this->featureDelivery->isFeatureDelivery($mission)) {
                $this->missionBoard->update($team, $mission->uuid, [
                    'status' => 'blocked',
                    'blocked_reason' => 'Run terminé — en attente de validation (PR/preview).',
                    'run_uuid' => $run->uuid,
                ]);

                return;
            }

            $this->missionBoard->update($team, $mission->uuid, [
                'status' => 'done',
                'run_uuid' => $run->uuid,
                'metadata' => [
                    'auto_closed_at' => now()->toISOString(),
                    'auto_closed_reason' => 'run_completed',
                ],
            ]);

            return;
        }

        if (in_array($run->status, ['failed', 'cancelled', 'error'], true)) {
            $summary = trim((string) ($run->summary ?? ''));
            $reason = match ($run->status) {
                'cancelled' => 'Run annulé — mission bloquée pour reprise.',
                default => $summary !== ''
                    ? 'Run en échec — '.mb_substr($summary, 0, 220)
                    : 'Run en échec — mission bloquée pour reprise.',
            };

            $this->missionBoard->update($team, $mission->uuid, [
                'status' => 'blocked',
                'blocked_reason' => $reason,
                'run_uuid' => $run->uuid,
                'metadata' => [
                    'auto_closed_at' => now()->toISOString(),
                    'auto_closed_reason' => 'run_'.$run->status,
                ],
            ]);
        }
    }
}
