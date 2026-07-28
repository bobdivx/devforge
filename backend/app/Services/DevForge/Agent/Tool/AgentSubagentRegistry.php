<?php

namespace App\Services\DevForge\Agent\Tool;

use App\Models\AiAgent;
use App\Models\AiAgentRun;
use App\Models\AiAgentSubagentRun;

/**
 * Registre des sous-agents — porté depuis forge-subagent-registry.ts (Forge).
 */
class AgentSubagentRegistry
{
    public function start(
        AiAgent $parent,
        AiAgent $child,
        ?AiAgentRun $parentRun = null,
        ?string $reason = null,
    ): AiAgentSubagentRun {
        return AiAgentSubagentRun::create([
            'parent_agent_id' => $parent->id,
            'child_agent_id' => $child->id,
            'parent_run_id' => $parentRun?->id,
            'status' => AiAgentSubagentRun::STATUS_PENDING,
            'reason' => $reason !== null ? mb_substr($reason, 0, 500) : null,
        ]);
    }

    public function markQueued(AiAgentSubagentRun $record, AiAgentRun $childRun): void
    {
        $record->update([
            'status' => AiAgentSubagentRun::STATUS_QUEUED,
            'child_run_id' => $childRun->id,
        ]);
    }

    public function markRunning(AiAgentSubagentRun $record, AiAgentRun $childRun): void
    {
        $record->update([
            'status' => AiAgentSubagentRun::STATUS_RUNNING,
            'child_run_id' => $childRun->id,
            'started_at' => now(),
        ]);
    }

    public function complete(AiAgentSubagentRun $record, ?string $output = null): void
    {
        $record->update([
            'status' => AiAgentSubagentRun::STATUS_COMPLETED,
            'output' => $output !== null ? mb_substr($output, 0, 32000) : null,
            'finished_at' => now(),
        ]);
    }

    public function fail(AiAgentSubagentRun $record, string $error): void
    {
        $record->update([
            'status' => AiAgentSubagentRun::STATUS_FAILED,
            'error' => mb_substr($error, 0, 4000),
            'finished_at' => now(),
        ]);
    }

    public function countActiveForParent(AiAgent $parent): int
    {
        return AiAgentSubagentRun::query()
            ->where('parent_agent_id', $parent->id)
            ->whereIn('status', [
                AiAgentSubagentRun::STATUS_PENDING,
                AiAgentSubagentRun::STATUS_QUEUED,
                AiAgentSubagentRun::STATUS_RUNNING,
            ])
            ->count();
    }

    public function countActiveForParentRun(AiAgentRun $parentRun): int
    {
        return AiAgentSubagentRun::query()
            ->where('parent_run_id', $parentRun->id)
            ->whereIn('status', [
                AiAgentSubagentRun::STATUS_PENDING,
                AiAgentSubagentRun::STATUS_QUEUED,
                AiAgentSubagentRun::STATUS_RUNNING,
            ])
            ->count();
    }
}
