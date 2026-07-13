<?php

namespace App\Services\DevForge\Agent;

use App\Models\AiAgent;
use App\Models\AiAgentMessage;
use App\Models\AiAgentRun;
use App\Services\DevForge\Agent\Contracts\LlmResponse;
use App\Services\DevForge\Core\CoreResourceAction;
use App\Services\DevForge\Core\CoreResourceCatalog;
use App\Services\DevForge\DeploymentData;
use Illuminate\Support\Collection;

class AgentChatService
{
    private const MAX_HISTORY = 30;

    private const MAX_TOOL_ITERATIONS = 8;

    public function __construct(
        private readonly LlmProviderFactory $providerFactory,
        private readonly CoreResourceCatalog $catalog,
        private readonly CoreResourceAction $resourceAction,
        private readonly DeploymentData $deploymentData,
        private readonly AgentPromptBuilder $promptBuilder,
    ) {}

    /**
     * @return Collection<int, AiAgentMessage>
     */
    public function history(AiAgent $agent): Collection
    {
        return AiAgentMessage::query()
            ->where('agent_id', $agent->id)
            ->orderBy('created_at')
            ->limit(self::MAX_HISTORY)
            ->get();
    }

    /**
     * @return array{user: AiAgentMessage, assistant: AiAgentMessage}
     */
    public function send(AiAgent $agent, string $content): array
    {
        $agent->loadMissing(['team', 'providerConfig']);

        if (! $agent->provider_config_id) {
            throw new \InvalidArgumentException('Aucun provider LLM configuré pour cet agent.');
        }

        $userMessage = AiAgentMessage::create([
            'agent_id' => $agent->id,
            'role' => 'user',
            'content' => trim($content),
        ]);

        $run = AiAgentRun::create([
            'agent_id' => $agent->id,
            'status' => 'running',
            'trigger' => 'chat',
            'started_at' => now(),
        ]);

        try {
            $reply = $this->generateReply($agent, $run);
            $assistantMessage = AiAgentMessage::create([
                'agent_id' => $agent->id,
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

            $agent->update(['status' => 'idle', 'last_run_at' => now()]);

            return [
                'user' => $userMessage,
                'assistant' => $assistantMessage,
            ];
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
     * @return array{text: string, tokens_used: int, iterations: int}
     */
    private function generateReply(AiAgent $agent, AiAgentRun $run): array
    {
        $provider = $this->providerFactory->makeForAgent(
            $agent,
            function (\Throwable $exception, string $primaryLabel, string $fallbackLabel) use ($run): void {
                $run->appendLog("Provider {$primaryLabel} indisponible, bascule vers {$fallbackLabel}.");
            },
        );

        $toolkit = new AgentToolkit(
            team: $agent->team,
            run: $run,
            catalog: $this->catalog,
            resourceAction: $this->resourceAction,
            deploymentData: $this->deploymentData,
            assignedResourceUuid: $agent->resource_uuid,
        );

        $history = $this->history($agent);
        $messages = [
            ['role' => 'system', 'content' => $this->promptBuilder->chatSystemPrompt($agent)],
            ...$history->map(fn (AiAgentMessage $message): array => [
                'role' => $message->role === 'assistant' ? 'assistant' : 'user',
                'content' => $message->content,
            ])->all(),
        ];

        $toolDefinitions = $toolkit->definitions();
        $iterations = 0;
        $tokensUsed = 0;
        $summary = '';

        while ($iterations < self::MAX_TOOL_ITERATIONS) {
            $iterations++;
            $run->appendLog("Itération chat #{$iterations}...");

            /** @var LlmResponse $response */
            $response = $provider->chat($messages, $toolDefinitions);
            $tokensUsed += $response->tokensUsed;

            if ($response->text) {
                $summary = $response->text;
            }

            if (! $response->hasToolCalls()) {
                break;
            }

            $toolResults = [];
            foreach ($response->toolCalls as $toolCall) {
                $toolResults[] = [
                    'name' => $toolCall['name'],
                    'result' => $toolkit->execute($toolCall['name'], $toolCall['arguments']),
                ];
            }

            AgentToolTurnBuilder::append($messages, $response, $toolResults);
        }

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
