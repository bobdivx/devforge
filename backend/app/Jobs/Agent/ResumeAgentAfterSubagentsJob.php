<?php

namespace App\Jobs\Agent;

use App\Events\AgentRunUpdated;
use App\Models\AiAgentRun;
use App\Models\AiAgentSession;
use App\Services\DevForge\Agent\AgentChatService;
use App\Services\DevForge\Agent\AgentRunner;
use App\Services\DevForge\Agent\AgentSubagentHandoff;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;

/**
 * Reprend un run parent après yield_wait + complétion des leafs.
 */
class ResumeAgentAfterSubagentsJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 1;

    public int $timeout;

    public function __construct(
        public readonly int $parentRunId,
    ) {
        $this->timeout = max(120, (int) config('devforge.agents_job_timeout', 1800));
        $this->onQueue('default');
    }

    public function handle(AgentRunner $runner, AgentSubagentHandoff $handoff, AgentChatService $chatService): void
    {
        $parentRun = AiAgentRun::query()->whereKey($this->parentRunId)->first();
        if ($parentRun === null) {
            return;
        }

        if ($parentRun->status !== 'waiting_for_subagents') {
            return;
        }

        $agent = $parentRun->agent;
        if ($agent === null) {
            return;
        }

        $completions = $handoff->collectCompletions($parentRun);
        $handoffMessage = $handoff->buildHandoffUserMessage($completions);

        $baseContext = is_array($parentRun->metadata['resume_context'] ?? null)
            ? $parentRun->metadata['resume_context']
            : [];

        $parentRun->mergeMetadata([
            'subagent_completions' => $completions,
        ]);
        $parentRun->update([
            'status' => 'completed',
            'summary' => mb_substr(
                'Yield terminé — reprise ('.count($completions).' leaf(s)).',
                0,
                1000,
            ),
            'finished_at' => now(),
        ]);
        $parentRun->appendLog('Handoff : reprise des sous-agents');
        broadcast(new AgentRunUpdated($agent, $parentRun->fresh() ?? $parentRun, 'yield_resumed'));

        $session = $parentRun->session_id
            ? AiAgentSession::query()->whereKey($parentRun->session_id)->first()
            : null;

        if ($session instanceof AiAgentSession) {
            try {
                $chatService->queueMessage($agent, $session, $handoffMessage, array_merge($baseContext, [
                    'resume_after_subagents' => true,
                    'subagent_completions' => $completions,
                    'chat_mode' => $baseContext['chat_mode'] ?? $session->chat_mode ?? 'build',
                ]));
            } catch (\Throwable $exception) {
                Log::warning('DevForge: échec reprise chat après sous-agents.', [
                    'parent_run_uuid' => $parentRun->uuid,
                    'error' => $exception->getMessage(),
                ]);
                throw $exception;
            }

            return;
        }

        $context = array_merge($baseContext, [
            'subagent_completions' => $completions,
            'subagent_handoff_message' => $handoffMessage,
            'resume_after_subagents' => true,
            'subagent_role' => $baseContext['subagent_role'] ?? 'orchestrator',
            'spawn_depth' => (int) ($baseContext['spawn_depth'] ?? 0),
        ]);

        $resumeRun = AiAgentRun::create([
            'agent_id' => $agent->id,
            'session_id' => $parentRun->session_id,
            'status' => 'pending',
            'trigger' => $parentRun->trigger ?: 'manual',
            'metadata' => [
                'resumed_from_run_uuid' => $parentRun->uuid,
                'subagent_completions' => $completions,
                'subagent_role' => $context['subagent_role'],
                'spawn_depth' => $context['spawn_depth'],
                'resume_after_subagents' => true,
            ],
        ]);

        $parentRun->mergeMetadata(['resumed_by_run_uuid' => $resumeRun->uuid]);

        $agent->prepareForEventDispatch();
        $agent->refresh();
        $agent->update(['status' => 'running']);

        try {
            $runner->run($agent->fresh(), $resumeRun, $context);
        } catch (\Throwable $exception) {
            Log::warning('DevForge: échec reprise après sous-agents.', [
                'parent_run_uuid' => $parentRun->uuid,
                'resume_run_uuid' => $resumeRun->uuid,
                'error' => $exception->getMessage(),
            ]);
            throw $exception;
        }
    }
}
