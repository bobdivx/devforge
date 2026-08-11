<?php

namespace App\Services\DevForge\Agent;

use App\Models\AiAgent;
use App\Models\AiAgentRun;
use App\Models\AiAgentSubagentRun;

/**
 * Annulation coopérative d’un run (entre itérations LLM).
 */
class AgentRunCancellation
{
    public const STATUS = 'cancelled';

    public function request(AiAgentRun $run, ?string $reason = null): AiAgentRun
    {
        $run->refresh();

        if (in_array($run->status, ['completed', 'failed', self::STATUS], true)) {
            return $run;
        }

        $metadata = is_array($run->metadata) ? $run->metadata : [];
        $metadata['cancel_requested'] = true;
        $metadata['cancel_requested_at'] = now()->toISOString();
        if ($reason !== null && trim($reason) !== '') {
            $metadata['cancel_reason'] = mb_substr(trim($reason), 0, 500);
        }

        $run->update([
            'status' => self::STATUS,
            'summary' => mb_substr($reason ?: 'Run annulé par l’utilisateur.', 0, 1000),
            'finished_at' => $run->finished_at ?? now(),
            'metadata' => $metadata,
        ]);
        $run->appendLog('Annulation demandée — arrêt du run.');

        AiAgentSubagentRun::query()
            ->where('parent_run_id', $run->id)
            ->whereIn('status', [
                AiAgentSubagentRun::STATUS_PENDING,
                AiAgentSubagentRun::STATUS_QUEUED,
                AiAgentSubagentRun::STATUS_RUNNING,
            ])
            ->update([
                'status' => AiAgentSubagentRun::STATUS_CANCELLED,
                'finished_at' => now(),
                'error' => 'Parent run annulé.',
            ]);

        $agent = $run->agent;
        if ($agent instanceof AiAgent && $agent->status === 'running') {
            $stillRunning = AiAgentRun::query()
                ->where('agent_id', $agent->id)
                ->whereIn('status', ['pending', 'running', 'waiting_for_subagents'])
                ->where('id', '!=', $run->id)
                ->exists();
            if (! $stillRunning) {
                $agent->update(['status' => 'idle', 'last_run_at' => now()]);
            }
        }

        return $run->fresh() ?? $run;
    }

    public function wasRequested(AiAgentRun $run): bool
    {
        $run->refresh();

        if ($run->status === self::STATUS) {
            return true;
        }

        $metadata = is_array($run->metadata) ? $run->metadata : [];

        return ($metadata['cancel_requested'] ?? false) === true;
    }

    public function activeSubagentCount(AiAgentRun $run): int
    {
        $dbCount = 0;
        try {
            $dbCount = AiAgentSubagentRun::query()
                ->where('parent_run_id', $run->id)
                ->whereIn('status', [
                    AiAgentSubagentRun::STATUS_PENDING,
                    AiAgentSubagentRun::STATUS_QUEUED,
                    AiAgentSubagentRun::STATUS_RUNNING,
                ])
                ->count();
        } catch (\Throwable) {
            $dbCount = 0;
        }

        $metadata = is_array($run->metadata) ? $run->metadata : [];
        $ephemeral = is_array($metadata['ephemeral_tasks'] ?? null) ? $metadata['ephemeral_tasks'] : [];
        $ephemeralActive = 0;
        foreach ($ephemeral as $task) {
            if (! is_array($task)) {
                continue;
            }
            $status = (string) ($task['status'] ?? '');
            if (in_array($status, ['pending', 'queued', 'running'], true)) {
                $ephemeralActive++;
            }
        }

        return $dbCount + $ephemeralActive;
    }
}
