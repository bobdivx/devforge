<?php

namespace App\Services\DevForge\Agent;

use App\Jobs\Agent\RunAgentChatJob;
use App\Models\AiAgent;
use App\Models\AiAgentMessage;
use App\Models\AiAgentRun;
use App\Models\AiAgentSession;

/**
 * Relance une tâche chat longue en arrière-plan (même session) — porté depuis Forge.
 */
class AgentChatLongTaskEnqueuer
{
    /**
     * @param  array<string, mixed>  $context
     * @return array{ok: true, run: AiAgentRun, message: AiAgentMessage}|array{ok: false, error: string}
     */
    public function enqueue(
        AiAgent $agent,
        AiAgentSession $session,
        string $originalUserMessage,
        string $partialReply,
        array $toolsUsed,
        array $context = [],
    ): array {
        if (! $agent->hasLlmProvider()) {
            return ['ok' => false, 'error' => 'Aucun provider LLM configuré.'];
        }

        $continuation = trim(<<<MSG
[DevForge — reprise automatique tâche longue]

## Demande utilisateur initiale
{$originalUserMessage}

## Contexte de reprise
Réponse partielle : {$partialReply}

Outils déjà utilisés : {$this->toolsList($toolsUsed)}

## Consigne
Continue et termine cette tâche de façon autonome avec de vrais tool_calls.
Ne redis pas seulement ce que tu vas faire. Termine par [DEVFORGE_DONE] quand c'est fait.
MSG);

        $userMessage = AiAgentMessage::create([
            'agent_id' => $agent->id,
            'session_id' => $session->id,
            'role' => 'user',
            'content' => mb_substr($continuation, 0, 50_000),
            'metadata' => [
                'source' => 'long_task_continuation',
                'auto' => true,
            ],
        ]);

        $metadata = array_merge($context, [
            'long_task' => true,
            'continuation_of_session' => $session->id,
        ]);

        $run = AiAgentRun::create([
            'agent_id' => $agent->id,
            'session_id' => $session->id,
            'status' => 'running',
            'trigger' => 'chat_continue',
            'started_at' => now(),
            'metadata' => $metadata,
        ]);

        $session->touchLastMessage();
        $agent->update(['status' => 'running']);

        RunAgentChatJob::dispatch($agent, $run, $userMessage);

        return ['ok' => true, 'run' => $run, 'message' => $userMessage];
    }

    /** @param  list<string>  $tools */
    private function toolsList(array $tools): string
    {
        $tools = array_values(array_unique(array_filter($tools)));

        return $tools === [] ? '(aucun)' : implode(', ', $tools);
    }
}
