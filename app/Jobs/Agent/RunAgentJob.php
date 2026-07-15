<?php

namespace App\Jobs\Agent;

use App\Models\AiAgent;
use App\Models\AiAgentRun;
use App\Services\DevForge\Agent\AgentRunner;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;

class RunAgentJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $timeout = 300;

    public int $tries = 1;

    public function __construct(
        public readonly AiAgent $agent,
        public readonly string $trigger = 'scheduled',
        /** @var array<string, mixed> */
        public readonly array $context = [],
        public readonly ?int $runId = null,
    ) {
        $this->onQueue('default');
    }

    public function handle(AgentRunner $runner): void
    {
        $this->agent->refresh();

        $run = $this->resolveRun();

        if ($run === null) {
            $this->recoverAgentAfterMissingRun();

            return;
        }

        $runner->run($this->agent->fresh(), $run, $this->context);
    }

    private function recoverAgentAfterMissingRun(): void
    {
        $this->agent->refresh();

        if ($this->runId === null) {
            return;
        }

        $run = AiAgentRun::query()
            ->whereKey($this->runId)
            ->where('agent_id', $this->agent->id)
            ->first();

        if ($run !== null && in_array($run->status, ['pending', 'running'], true)) {
            return;
        }

        if ($this->agent->status === 'running') {
            $this->agent->prepareForEventDispatch();
        }
    }

    public function failed(\Throwable $exception): void
    {
        $this->agent->update(['status' => 'error', 'last_run_at' => now()]);

        $query = AiAgentRun::where('agent_id', $this->agent->id)
            ->whereIn('status', ['pending', 'running']);

        if ($this->runId !== null) {
            $query->whereKey($this->runId);
        }

        $query->update([
            'status' => 'failed',
            'summary' => 'Job échoué: '.mb_substr($exception->getMessage(), 0, 500),
            'finished_at' => now(),
        ]);
    }

    private function resolveRun(): ?AiAgentRun
    {
        if ($this->runId !== null) {
            $run = AiAgentRun::query()
                ->whereKey($this->runId)
                ->where('agent_id', $this->agent->id)
                ->first();

            if ($run === null || $run->status !== 'pending') {
                return null;
            }

            return $run;
        }

        $this->agent->recoverIfInterrupted();
        $this->agent->refresh();

        if ($this->agent->status === 'running') {
            return null;
        }

        $this->agent->update(['status' => 'running']);

        $run = AiAgentRun::create([
            'agent_id' => $this->agent->id,
            'status' => 'pending',
            'trigger' => $this->trigger,
        ]);

        if ($this->context !== []) {
            $run->appendLog('Contexte événement: '.json_encode($this->context, JSON_UNESCAPED_UNICODE));
        }

        return $run;
    }
}
