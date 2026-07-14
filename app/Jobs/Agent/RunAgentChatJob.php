<?php

namespace App\Jobs\Agent;

use App\Models\AiAgent;
use App\Models\AiAgentMessage;
use App\Models\AiAgentRun;
use App\Services\DevForge\Agent\AgentChatService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;

class RunAgentChatJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $timeout = 300;

    public int $tries = 1;

    public function __construct(
        public readonly AiAgent $agent,
        public readonly AiAgentRun $run,
        public readonly AiAgentMessage $userMessage,
    ) {
        $this->onQueue('default');
    }

    public function handle(AgentChatService $chatService): void
    {
        $this->agent->refresh();
        $this->run->refresh();
        $this->userMessage->refresh();

        if ($this->run->status !== 'running') {
            return;
        }

        $chatService->processQueuedRun($this->agent, $this->run, $this->userMessage);
    }

    public function failed(\Throwable $exception): void
    {
        if ($this->run->status === 'running') {
            $this->run->appendLog('Job échoué: '.mb_substr($exception->getMessage(), 0, 500));
            $this->run->update([
                'status' => 'failed',
                'summary' => 'Job échoué: '.mb_substr($exception->getMessage(), 0, 500),
                'finished_at' => now(),
            ]);
        }

        $this->agent->update(['status' => 'error', 'last_run_at' => now()]);
    }
}
