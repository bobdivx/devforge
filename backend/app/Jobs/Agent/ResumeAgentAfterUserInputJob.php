<?php

namespace App\Jobs\Agent;

use App\Models\AiAgent;
use App\Models\AiAgentKeyRequest;
use App\Models\AiAgentRun;
use App\Services\DevForge\Agent\AgentMissionBoard;
use App\Services\DevForge\Agent\AgentRunLauncher;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;

/**
 * Reprend un agent après fourniture d'une clé / token / confirmation utilisateur.
 * Le secret n'est jamais renvoyé dans le contexte LLM — seulement la preuve qu'il a été injecté.
 */
class ResumeAgentAfterUserInputJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 1;

    public int $timeout = 120;

    public function __construct(
        public readonly int $keyRequestId,
    ) {
        $this->onQueue('default');
    }

    public function handle(AgentRunLauncher $launcher, AgentMissionBoard $missionBoard): void
    {
        $request = AiAgentKeyRequest::query()->whereKey($this->keyRequestId)->first();
        if ($request === null || $request->status !== 'fulfilled') {
            return;
        }

        $agent = $request->agent;
        if (! $agent instanceof AiAgent) {
            return;
        }

        if (is_string($request->mission_uuid) && $request->mission_uuid !== '' && $agent->team) {
            $missionBoard->update($agent->team, $request->mission_uuid, [
                'status' => 'open',
                'blocked_reason' => '',
                'metadata' => [
                    'user_input_resolved_key' => $request->key_name,
                    'user_input_resolved_at' => now()->toISOString(),
                ],
            ]);
        }

        $previousRun = $request->run_id
            ? AiAgentRun::query()->whereKey($request->run_id)->first()
            : null;

        $context = [
            'event' => 'user_input_resolved',
            'resume_after_user_input' => true,
            'user_input_key' => $request->key_name,
            'user_input_kind' => $request->kind ?? 'secret',
            'request_uuid' => $request->uuid,
            'mission_uuid' => $request->mission_uuid,
            'application_uuid' => $request->resource_uuid,
            'resource_uuid' => $request->resource_uuid,
            'user_input_handoff_message' => sprintf(
                '[User Input Resolved] La valeur pour « %s » a été enregistrée (sans être exposée). Reprends le travail%s.',
                $request->key_name,
                is_string($request->mission_uuid) && $request->mission_uuid !== ''
                    ? ' sur la mission '.$request->mission_uuid
                    : '',
            ),
        ];

        if ($previousRun instanceof AiAgentRun) {
            $previousRun->appendLog("Utilisateur a fourni « {$request->key_name} » — reprise planifiée.");
        }

        $run = $launcher->queue($agent, 'event', $context);
        if ($run === null) {
            Log::info('DevForge: reprise user_input différée (agent busy).', [
                'agent_uuid' => $agent->uuid,
                'request_uuid' => $request->uuid,
            ]);
        }
    }
}
