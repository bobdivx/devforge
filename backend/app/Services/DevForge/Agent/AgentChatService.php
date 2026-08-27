<?php

namespace App\Services\DevForge\Agent;

use App\Jobs\Agent\RunAgentChatJob;
use App\Models\AiAgent;
use App\Models\AiAgentMessage;
use App\Models\AiAgentRun;
use App\Models\AiAgentSession;
use App\Models\User;
use App\Services\DevForge\Agent\Contracts\LlmResponse;
use App\Services\DevForge\Agent\Tool\AgentSubagentRegistry;
use App\Services\DevForge\Agent\Tool\AgentToolApprovalGrant;
use App\Services\DevForge\Agent\Tool\IterationBudget;
use App\Services\DevForge\Core\CoreResourceAction;
use App\Services\DevForge\Core\CoreResourceCatalog;
use App\Services\DevForge\DeploymentData;
use Illuminate\Support\Collection;

class AgentChatService
{
    private const MAX_HISTORY = 30;

    public function __construct(

        private readonly LlmProviderFactory $providerFactory,

        private readonly CoreResourceCatalog $catalog,

        private readonly CoreResourceAction $resourceAction,

        private readonly DeploymentData $deploymentData,

        private readonly AgentPromptBuilder $promptBuilder,

        private readonly TaskModelRouter $taskModelRouter,

        private readonly AgentSessionService $sessionService,

    ) {}

    /**
     * @return Collection<int, AiAgentMessage>
     */
    public function history(AiAgent $agent, AiAgentSession $session): Collection
    {

        return AiAgentMessage::query()

            ->where('agent_id', $agent->id)

            ->where('session_id', $session->id)

            ->orderBy('created_at')

            ->limit(self::MAX_HISTORY)

            ->get();

    }

    /**
     * @param  array<string, mixed>  $context
     * @return array{user: AiAgentMessage, run: AiAgentRun}
     */
    public function queueMessage(AiAgent $agent, AiAgentSession $session, string $content, array $context = []): array
    {

        $agent->loadMissing(['team', 'providerConfig']);

        if (! $agent->hasLlmProvider()) {

            throw new \InvalidArgumentException('Aucun provider LLM configuré pour cet agent.');
        }

        $trimmed = trim($content);
        $attachments = $context['attachments'] ?? null;
        if (is_array($attachments) && $attachments !== []) {
            $trimmed = app(AgentChatAttachments::class)->appendToContent($trimmed, $attachments);
        }

        if ($trimmed === '') {
            throw new \InvalidArgumentException('Message vide.');
        }

        if (isset($context['chat_mode'])) {
            $session->update([
                'chat_mode' => AgentChatMode::parse($context['chat_mode']),
            ]);
            $session->refresh();
        }

        $this->sessionService->autoTitleFromMessage($session, $trimmed);

        $userMessage = AiAgentMessage::create([

            'agent_id' => $agent->id,

            'session_id' => $session->id,

            'role' => 'user',

            'content' => $trimmed,

            'metadata' => array_filter([
                'attachments' => is_array($attachments) && $attachments !== [] ? array_slice($attachments, 0, 8) : null,
                'chat_mode' => AgentChatMode::parse($session->chat_mode ?? ($context['chat_mode'] ?? 'build')),
            ]),

        ]);

        $run = AiAgentRun::create([

            'agent_id' => $agent->id,

            'session_id' => $session->id,

            'status' => 'running',

            'trigger' => 'chat',

            'started_at' => now(),

            'metadata' => $this->initialChatMetadata($context, $session),

        ]);

        $session->touchLastMessage();

        $agent->update(['status' => 'running']);

        RunAgentChatJob::dispatch($agent, $run, $userMessage);

        return [

            'user' => $userMessage,

            'run' => $run,

        ];

    }

    public function processQueuedRun(AiAgent $agent, AiAgentRun $run, AiAgentMessage $userMessage): AiAgentMessage
    {

        try {

            $reply = app(RigAgentClient::class)->enabled()
                ? app(RigChatRuntime::class)->completeFromChat($agent, $run, $userMessage, $this->promptBuilder)
                : $this->generateReply($agent, $run, $userMessage);

            $run->refresh();
            if ($run->status === AgentRunCancellation::STATUS || ! empty($reply['cancelled'])) {
                $assistantMessage = AiAgentMessage::create([
                    'agent_id' => $agent->id,
                    'session_id' => $userMessage->session_id,
                    'run_id' => $run->id,
                    'role' => 'assistant',
                    'content' => (string) ($reply['text'] ?? 'Run annulé.'),
                    'metadata' => [
                        'tokens_used' => $reply['tokens_used'] ?? 0,
                        'iterations' => $reply['iterations'] ?? 0,
                        'steps' => $reply['steps'] ?? [],
                        'cancelled' => true,
                    ],
                ]);
                $agent->update(['status' => 'idle', 'last_run_at' => now()]);

                return $assistantMessage;
            }

            $metadata = [

                'tokens_used' => $reply['tokens_used'],

                'iterations' => $reply['iterations'],

            ];

            if (isset($reply['pending_approval']) && is_array($reply['pending_approval'])) {

                $metadata['pending_approval'] = $reply['pending_approval'];

            }

            if (isset($reply['pending_plan']) && is_array($reply['pending_plan'])) {

                $metadata['pending_plan'] = $reply['pending_plan'];

            }

            if (isset($reply['steps']) && is_array($reply['steps']) && $reply['steps'] !== []) {

                $metadata['steps'] = $reply['steps'];

            }

            if (isset($reply['long_task_id'])) {

                $metadata['long_task_id'] = $reply['long_task_id'];

            }

            $assistantMessage = AiAgentMessage::create([

                'agent_id' => $agent->id,

                'session_id' => $userMessage->session_id,

                'run_id' => $run->id,

                'role' => 'assistant',

                'content' => $reply['text'],

                'metadata' => $metadata,

            ]);

            $runStatus = (isset($reply['pending_approval']) || isset($reply['pending_plan']))
                ? 'awaiting_approval'
                : (! empty($reply['waiting_for_subagents']) ? 'waiting_for_subagents' : 'completed');

            $run->refresh();
            if ($run->status === AgentRunCancellation::STATUS) {
                $agent->update(['status' => 'idle', 'last_run_at' => now()]);

                return $assistantMessage;
            }
            if ($run->status === 'waiting_for_subagents' && ! empty($reply['waiting_for_subagents'])) {
                $run->update([
                    'summary' => mb_substr($reply['text'], 0, 500),
                    'tokens_used' => $reply['tokens_used'],
                    'iterations' => $reply['iterations'],
                ]);
            } else {
                $run->update([
                    'status' => $runStatus,
                    'summary' => mb_substr($reply['text'], 0, 500),
                    'tokens_used' => $reply['tokens_used'],
                    'iterations' => $reply['iterations'],
                    'finished_at' => now(),
                ]);
            }

            if ($userMessage->session_id !== null) {

                AiAgentSession::query()

                    ->whereKey($userMessage->session_id)

                    ->update(['last_message_at' => now()]);

            }

            $agent->update(['status' => 'idle', 'last_run_at' => now()]);

            return $assistantMessage;

        } catch (\Throwable $exception) {

            $run->refresh();
            if ($run->status === AgentRunCancellation::STATUS) {
                $agent->update(['status' => 'idle', 'last_run_at' => now()]);

                throw $exception;
            }

            $run->appendLog('Erreur: '.$exception->getMessage());

            $run->update([

                'status' => 'failed',

                'summary' => 'Erreur: '.mb_substr($exception->getMessage(), 0, 500),

                'finished_at' => now(),

            ]);

            $agent->update(['status' => 'error', 'last_run_at' => now()]);

            throw $exception;
        }

    }
}
