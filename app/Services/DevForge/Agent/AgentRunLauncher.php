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
            'metadata' => $this->initialMetadata($context),
        ]);

        if ($context !== []) {
            $run->appendLog('Contexte événement: '.json_encode($context, JSON_UNESCAPED_UNICODE));
        }

        $agent->update(['status' => 'running']);

        RunAgentJob::dispatch($agent, $trigger, $context, $run->id);

        return $run;
    }

    /**
     * @param  array<string, mixed>  $context
     * @return array<string, mixed>|null
     */
    private function initialMetadata(array $context): ?array
    {
        $metadata = array_filter([
            'deployment_uuid' => is_string($context['deployment_uuid'] ?? null) ? $context['deployment_uuid'] : null,
            'application_uuid' => is_string($context['application_uuid'] ?? null) ? $context['application_uuid'] : null,
            'event' => is_string($context['event'] ?? null) ? $context['event'] : null,
        ], fn (?string $value): bool => $value !== null && $value !== '');

        return $metadata === [] ? null : $metadata;
    }
}
