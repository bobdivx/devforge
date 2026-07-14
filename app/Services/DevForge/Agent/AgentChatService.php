<?php

namespace App\Services\DevForge\Agent;

use App\Jobs\Agent\RunAgentChatJob;
use App\Models\AiAgent;
use App\Models\AiAgentMessage;
use App\Models\AiAgentRun;
use App\Models\AiAgentSession;
use App\Models\User;
use App\Services\DevForge\Agent\Contracts\LlmResponse;
use App\Services\DevForge\Core\CoreResourceAction;
use App\Services\DevForge\Core\CoreResourceCatalog;
use App\Services\DevForge\DeploymentData;
use App\Services\DevForge\Agent\Tool\IterationBudget;
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
     * @return array{user: AiAgentMessage, run: AiAgentRun}
     */
    public function queueMessage(AiAgent $agent, AiAgentSession $session, string $content): array
    {
        $agent->loadMissing(['team', 'providerConfig']);

        if (! $agent->hasLlmProvider()) {
            throw new \InvalidArgumentException('Aucun provider LLM configuré pour cet agent.');
        }

        $trimmed = trim($content);
        $this->sessionService->autoTitleFromMessage($session, $trimmed);

        $userMessage = AiAgentMessage::create([
            'agent_id' => $agent->id,
            'session_id' => $session->id,
            'role' => 'user',
            'content' => $trimmed,
        ]);

        $run = AiAgentRun::create([
            'agent_id' => $agent->id,
            'session_id' => $session->id,
            'status' => 'running',
            'trigger' => 'chat',
            'started_at' => now(),
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
            $reply = $this->generateReply($agent, $run, $userMessage);
            $assistantMessage = AiAgentMessage::create([
                'agent_id' => $agent->id,
                'session_id' => $userMessage->session_id,
                'run_id' => $run->id,
                'role' => 'assistant',
                'content' => $reply['text'],
                'metadata' => [
                    'tokens_used' => $reply['tokens_used'],
                    'iterations' => $reply['iterations'],
                ],
            ]);

            $run->update([
                'status' => 'completed',
                'summary' => mb_substr($reply['text'], 0, 500),
                'tokens_used' => $reply['tokens_used'],
                'iterations' => $reply['iterations'],
                'finished_at' => now(),
            ]);

            if ($userMessage->session_id !== null) {
                AiAgentSession::query()
                    ->whereKey($userMessage->session_id)
                    ->update(['last_message_at' => now()]);
            }

            $agent->update(['status' => 'idle', 'last_run_at' => now()]);

            return $assistantMessage;
        } catch (\Throwable $exception) {
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

    /**
     * @return array{user: AiAgentMessage, assistant: AiAgentMessage}
     *
     * @deprecated Prefer queueMessage() for HTTP requests.
     */
    public function send(AiAgent $agent, User $user, AiAgentSession $session, string $content): array
    {
        $queued = $this->queueMessage($agent, $session, $content);

        $assistantMessage = $this->processQueuedRun($agent, $queued['run'], $queued['user']);

        return [
            'user' => $queued['user'],
            'assistant' => $assistantMessage,
        ];
    }

    /**
     * @return array{text: string, tokens_used: int, iterations: int}
     */
    private function generateReply(AiAgent $agent, AiAgentRun $run, AiAgentMessage $userMessage): array
    {
        $userContent = trim($userMessage->content);
        $tier = $this->taskModelRouter->classify($userContent, 'chat', $agent->type, []);
        $reason = $this->taskModelRouter->reason($userContent, 'chat', $agent->type, [], $tier);
        $routing = $this->taskModelRouter->routingPayload($tier, $reason);
        $run->mergeMetadata(['model_routing' => $routing]);
        $run->appendLog('Chat — '.$routing['display'].' ('.$routing['tier_label'].') : '.$reason);

        $provider = $this->providerFactory->makeForAgent(
            $agent,
            function (\Throwable $exception, string $primaryLabel, string $fallbackLabel) use ($run): void {
                $run->appendLog("Provider {$primaryLabel} indisponible, bascule vers {$fallbackLabel}.");
            },
            config('devforge.agents_smart_routing', true) ? $tier : null,
        );

        $delegator = new AgentDelegator(
            app(AgentRunner::class),
            app(\App\Services\DevForge\Agent\Tool\AgentSubagentRegistry::class),
            $this->taskModelRouter,
        );
        $toolkit = new AgentToolkit(
            team: $agent->team,
            run: $run,
            catalog: $this->catalog,
            resourceAction: $this->resourceAction,
            deploymentData: $this->deploymentData,
            agent: $agent,
            assignedResourceUuid: $agent->resource_uuid,
            delegator: $delegator,
        );

        $session = $userMessage->session;
        if (! $session instanceof AiAgentSession) {
            throw new \RuntimeException('Message de chat sans session associée.');
        }

        $history = $this->history($agent, $session);
        $messages = [
            ['role' => 'system', 'content' => $this->promptBuilder->chatSystemPrompt($agent, $userContent)],
            ...$history->map(fn (AiAgentMessage $message): array => [
                'role' => $message->role === 'assistant' ? 'assistant' : 'user',
                'content' => $message->content,
            ])->all(),
        ];

        $budget = new IterationBudget((int) config('devforge.agents_chat_max_iterations', 20));
        $tokensUsed = 0;
        $summary = '';
        $toolNudgeUsed = false;
        $confirmationNudgeUsed = false;
        $toolsUsedThisTurn = false;

        while ($budget->consume()) {
            $iterations = $budget->getUsed();
            $run->appendLog("Itération chat #{$iterations}...");

            /** @var LlmResponse $response */
            $response = $provider->chat($messages, $toolkit->definitions());
            $tokensUsed += $response->tokensUsed;

            if ($response->text) {
                $summary = $response->text;
            }

            if (! $response->hasToolCalls()) {
                if (! $toolNudgeUsed && ! $toolsUsedThisTurn) {
                    $toolNudgeUsed = true;
                    $messages[] = ['role' => 'assistant', 'content' => $response->text ?: 'En attente d\'action.'];
                    $messages[] = ['role' => 'user', 'content' => AgentDirectives::chatToolNudgeMessage($userContent)];
                    $run->appendLog('Relance chat : premier tour sans outil — consigne d\'action envoyée.');
                    continue;
                }

                if (! $confirmationNudgeUsed && AgentDirectives::defersToUser($response->text)) {
                    $confirmationNudgeUsed = true;
                    $messages[] = ['role' => 'assistant', 'content' => $response->text];
                    $messages[] = ['role' => 'user', 'content' => AgentDirectives::chatConfirmationNudgeMessage()];
                    $run->appendLog('Relance chat : demande de confirmation détectée — consigne d\'exécution immédiate.');
                    continue;
                }

                break;
            }

            $toolsUsedThisTurn = true;

            $toolResults = [];
            $hadToolFailure = false;
            foreach ($response->toolCalls as $toolCall) {
                $result = $toolkit->execute($toolCall['name'], $toolCall['arguments']);
                if (isset($result['error'])) {
                    $hadToolFailure = true;
                }
                $toolResults[] = [
                    'name' => $toolCall['name'],
                    'result' => $result,
                ];
            }

            if (! $hadToolFailure) {
                $budget->refund();
            }

            AgentToolTurnBuilder::append($messages, $response, $toolResults);
        }

        $iterations = $budget->getUsed();

        if ($summary === '') {
            $summary = 'Je n\'ai pas pu générer de réponse.';
        }

        return [
            'text' => $summary,
            'tokens_used' => $tokensUsed,
            'iterations' => $iterations,
        ];
    }
}
