<?php

namespace App\Services\DevForge\Agent;

use App\Jobs\Agent\RunAgentJob;
use App\Models\AiAgent;
use App\Models\AiAgentRun;

class AgentRunLauncher
{
    /**
     * @param  array<string, mixed>  $context
     */
    public function queue(AiAgent $agent, string $trigger, array $context = []): ?AiAgentRun
    {
        $agent->refresh();
        $agent->recoverIfInterrupted();
        $agent->refresh();

        if ($agent->status === 'running') {
            return null;
        }

        $run = AiAgentRun::create([
            'agent_id' => $agent->id,
            'status' => 'pending',
            'trigger' => $trigger,
        ]);

        if ($context !== []) {
            $run->appendLog('Contexte événement: '.json_encode($context, JSON_UNESCAPED_UNICODE));
        }

        $agent->update(['status' => 'running']);

        RunAgentJob::dispatch($agent, $trigger, $context, $run->id);

        return $run;
    }
}
