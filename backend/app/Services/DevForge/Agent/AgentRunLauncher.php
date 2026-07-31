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

        if (in_array($trigger, ['event', 'delegation'], true)) {
            $agent->prepareForEventDispatch();
        } else {
            $agent->recoverIfInterrupted();
        }

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
            'pull_request_number' => isset($context['pull_request_number']) && is_numeric($context['pull_request_number'])
                ? (int) $context['pull_request_number']
                : null,
            'fingerprint' => is_string($context['fingerprint'] ?? null) ? $context['fingerprint'] : null,
            'workflow_run_id' => isset($context['workflow_run_id']) && is_numeric($context['workflow_run_id'])
                ? (int) $context['workflow_run_id']
                : null,
            'parent_run_uuid' => is_string($context['parent_run_uuid'] ?? null) ? $context['parent_run_uuid'] : null,
            'resume_after_approval' => ! empty($context['resume_after_approval']) ? true : null,
            'readiness_round' => isset($context['readiness_round']) && is_numeric($context['readiness_round'])
                ? (int) $context['readiness_round']
                : null,
            'subagent_role' => is_string($context['subagent_role'] ?? null) ? $context['subagent_role'] : null,
            'spawn_depth' => isset($context['spawn_depth']) && is_numeric($context['spawn_depth'])
                ? (int) $context['spawn_depth']
                : null,
            'deploy_pipeline' => is_array($context['deploy_pipeline'] ?? null) ? $context['deploy_pipeline'] : null,
            'max_redeploy' => isset($context['max_redeploy']) && is_numeric($context['max_redeploy'])
                ? (int) $context['max_redeploy']
                : null,
        ], fn (mixed $value): bool => $value !== null && $value !== '');

        return $metadata === [] ? null : $metadata;
    }
}
