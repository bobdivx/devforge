<?php

namespace App\Services\DevForge\Agent;

use App\Models\AiAgent;
use App\Models\AiAgentMessage;
use App\Models\AiAgentRun;
use App\Models\AiAgentSession;

class RigChatRuntime
{
    public function __construct(
        private readonly RigAgentClient $rig,
        private readonly AgentContextCompactor $compactor,
    ) {}

    /**
     * @return array{text: string, tokens_used: int, iterations: int, steps: list<array<string, mixed>>}
     */
    public function completeFromChat(
        AiAgent $agent,
        AiAgentRun $run,
        AiAgentMessage $userMessage,
        AgentPromptBuilder $promptBuilder,
    ): array {
        $session = $userMessage->session;
        if (! $session instanceof AiAgentSession) {
            throw new \RuntimeException('Message de chat sans session associée.');
        }

        $userContent = trim($userMessage->content);
        $chatContext = is_array($run->metadata) ? $run->metadata : [];
        $history = AiAgentMessage::query()
            ->where('agent_id', $agent->id)
            ->where('session_id', $session->id)
            ->orderBy('created_at')
            ->limit(30)
            ->get();

        $messages = [
            ['role' => 'system', 'content' => $promptBuilder->chatSystemPrompt($agent, $userContent, [
                ...$chatContext,
                'chat_mode' => AgentChatMode::parse($chatContext['chat_mode'] ?? $session->chat_mode ?? 'build'),
            ])],
            ...$history->map(function (AiAgentMessage $message): array {
                $content = $message->content;
                if ($message->role === 'assistant') {
                    $content = $this->compactor->enrichAssistantContent(
                        $content,
                        is_array($message->metadata) ? $message->metadata : null,
                    );
                }

                return [
                    'role' => $message->role === 'assistant' ? 'assistant' : 'user',
                    'content' => $content,
                ];
            })->all(),
        ];

        $messages = $this->compactor->compact(
            $messages,
            (int) config('devforge.agents_chat_context_max_chars', 48000),
        );

        $run->appendLog('Chat via sidecar Rig (MCP DevForge).');

        return $this->complete($agent, $run, $userContent, $messages, $session);
    }

    /**
     * @param  list<array{role: string, content: string}>  $messages
     * @return array{text: string, tokens_used: int, iterations: int, steps: list<array<string, mixed>>}
     */
    public function complete(
        AiAgent $agent,
        AiAgentRun $run,
        string $userContent,
        array $messages,
        ?AiAgentSession $session = null,
    ): array {
        $llm = $this->rig->llmFromProviderSettings(agent: $agent, teamId: $agent->team_id) ?? [];
        $preamble = null;
        $prompt = $userContent;
        $history = [];

        foreach ($messages as $message) {
            $role = (string) ($message['role'] ?? '');
            $content = (string) ($message['content'] ?? '');
            if ($role === 'system' && $preamble === null) {
                $preamble = $content;
                continue;
            }
            $history[] = ['role' => $role, 'content' => $content];
        }

        if ($prompt === '' && $history !== []) {
            for ($i = count($history) - 1; $i >= 0; $i--) {
                if (($history[$i]['role'] ?? '') === 'user') {
                    $prompt = $history[$i]['content'];
                    break;
                }
            }
        }

        $credentials = $this->rig->issueMcpCredentials($agent, $session);

        try {
            $text = $this->rig->chat(
                $prompt !== '' ? $prompt : 'Continue.',
                $preamble,
                $llm['model'] ?? null,
                $llm,
                [
                    'messages' => $history,
                    'mcp_url' => $credentials['url'],
                    'mcp_token' => $credentials['token'],
                ],
            );
        } finally {
            $this->rig->revokeMcpCredentials($credentials['id'] ?? null);
        }

        $text = trim($text);
        if ($text === '') {
            $text = 'Je n\'ai pas pu générer de réponse.';
        }

        $run->mergeMetadata([
            'runtime' => 'rig-mcp',
            'live_assistant_text' => mb_substr($text, 0, 4000),
        ]);
        $run->update([
            'summary' => mb_substr($text, 0, 1000),
            'iterations' => 1,
        ]);

        return [
            'text' => $text,
            'tokens_used' => 0,
            'iterations' => 1,
            'steps' => [],
        ];
    }
}
