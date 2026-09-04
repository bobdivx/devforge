<?php

namespace App\Services\DevForge\Agent;

use App\Models\AiAgent;
use App\Models\AiAgentMessage;
use App\Models\AiAgentRun;
use App\Models\AiAgentSession;
use App\Services\DevForge\Core\CoreResourceAction;
use App\Services\DevForge\Core\CoreResourceCatalog;
use App\Services\DevForge\DeploymentData;

class RigChatRuntime
{
    private const MAX_TEXT_TOOL_TURNS = 8;

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
        $steps = [];
        $iterations = 0;
        $text = '';
        $statusNudgeUsed = false;
        $attemptedLlmKeys = [];
        $crossProviderAttempts = 0;
        $maxCrossProviderAttempts = 3;

        try {
            while ($iterations < self::MAX_TEXT_TOOL_TURNS) {
                $iterations++;
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
                } catch (\Throwable $exception) {
                    if (! AgentChatEmptyReplyFallback::isEmptyCompletionFailure($exception->getMessage())) {
                        throw $exception;
                    }

                    app(AgentChatEmptyReplyFallback::class)->log(
                        $run,
                        $exception->getMessage(),
                        'empty_completion_error',
                    );
                    $text = '';
                }

                $text = trim($text);
                $calls = AgentDirectives::extractProseToolCalls($text);
                if ($calls === []) {
                    $isAbsurd = AgentEmptyAbsurdReply::isEmptyOrAbsurd($text, false, $userContent);
                    if ($isAbsurd) {
                        if ($text !== '') {
                            app(AgentChatEmptyReplyFallback::class)->log($run, $text);
                        }
                        $text = '';

                        if ($crossProviderAttempts < $maxCrossProviderAttempts) {
                            $next = app(AgentChatEmptyReplyFallback::class)->nextCrossProviderLlmPayload(
                                $agent,
                                $llm,
                                $attemptedLlmKeys,
                            );
                            if (is_array($next)) {
                                $crossProviderAttempts++;
                                $llm = $next;
                                $label = ($next['provider'] ?? '?').'/'.($next['model'] ?? '?');
                                $run->appendLog('Fallback cross-provider : nouvel essai avec '.$label.'.');
                                $prompt = $userContent !== '' ? $userContent : $prompt;
                                continue;
                            }
                        }

                        if (AgentDirectives::isChatRepairIntent($userContent)) {
                            $run->appendLog('Fallback : intention réparation — harness forcé (réponse vide/absurde).');
                            $toolkit = $this->makeToolkit($agent, $run);
                            $runContext = is_array($run->metadata) ? $run->metadata : [];
                            $harness = app(AgentRepairHarness::class)->execute(
                                $toolkit,
                                $agent,
                                $run,
                                $runContext,
                                $userContent,
                            );
                            $text = (string) ($harness['text'] ?? '');
                            $steps = [...$steps, ...($harness['steps'] ?? [])];
                            break;
                        }
                    }

                    if (! $statusNudgeUsed && AgentChatStatusDirectives::requiresChatTools($userContent)) {
                        $statusNudgeUsed = true;
                        $nudge = AgentChatStatusDirectives::chatToolNudgeMessage($userContent);
                        $history[] = ['role' => 'assistant', 'content' => AgentEmptyAbsurdReply::historyContent($text)];
                        $history[] = ['role' => 'user', 'content' => $nudge];
                        $prompt = $nudge;
                        $run->appendLog('Relance Rig : question statut/santé sans outil — consigne d\'action envoyée.');
                        continue;
                    }
                    break;
                }

                $run->appendLog('Tool calls extraits du texte sidecar ('.count($calls).').');
                $toolkit = $this->makeToolkit($agent, $run);
                $results = [];
                $waitingForInput = false;

                foreach ($calls as $call) {
                    $name = (string) ($call['name'] ?? '');
                    $arguments = is_array($call['arguments'] ?? null) ? $call['arguments'] : [];
                    $result = $toolkit->execute($name, $arguments);
                    $steps[] = [
                        'type' => 'tool',
                        'name' => $name,
                        'args_summary' => $this->summarizeToolArgs($arguments),
                        'result_summary' => $this->summarizeToolResult($result),
                        'status' => isset($result['error'])
                            ? 'error'
                            : (($result['status'] ?? null) === 'ask' || ! empty($result['pending_approval']) ? 'awaiting_approval' : 'done'),
                    ];
                    $results[] = [
                        'name' => $name,
                        'result' => $result,
                    ];
                    if (($result['status'] ?? '') === 'waiting_for_input') {
                        $waitingForInput = true;
                    }
                }

                if ($waitingForInput) {
                    $text = (string) ($results[0]['result']['message'] ?? 'En attente de saisie utilisateur.');
                    $run->update([
                        'status' => 'waiting_for_input',
                        'summary' => mb_substr($text, 0, 1000),
                    ]);
                    break;
                }

                $encoded = json_encode($results, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: '{}';
                $history[] = ['role' => 'assistant', 'content' => $text];
                $history[] = [
                    'role' => 'user',
                    'content' => "Résultat des outils (déjà exécutés, ne les réécris pas en JSON ou XML) :\n{$encoded}\nRéponds en français à l'utilisateur.",
                ];
                $prompt = 'Continue avec les résultats d’outils. Réponds en français, sans bloc d’outil XML ou JSON.';
            }
        } finally {
            $this->rig->revokeMcpCredentials($credentials['id'] ?? null);
        }

        $text = $this->hideRawToolJson(trim($text));
        if ($text === '' || AgentEmptyAbsurdReply::isEmptyOrAbsurd($text, $steps !== [], $userContent)) {
            $text = AgentEmptyAbsurdReply::userFacingFailureMessage(
                isset($llm['model']) && is_string($llm['model']) ? $llm['model'] : null,
                isset($llm['provider']) && is_string($llm['provider']) ? $llm['provider'] : null,
                isset($llm['base_url']) && is_string($llm['base_url']) ? $llm['base_url'] : null,
            );
        }

        $run->mergeMetadata([
            'runtime' => 'rig-mcp',
            'live_assistant_text' => mb_substr($text, 0, 4000),
        ]);
        $run->update([
            'summary' => mb_substr($text, 0, 1000),
            'iterations' => $iterations,
        ]);

        return [
            'text' => $text,
            'tokens_used' => 0,
            'iterations' => $iterations,
            'steps' => $steps,
        ];
    }

    private function makeToolkit(AiAgent $agent, AiAgentRun $run): AgentToolkit
    {
        $agent->loadMissing(['team']);

        return new AgentToolkit(
            team: $agent->team,
            run: $run,
            catalog: app(CoreResourceCatalog::class),
            resourceAction: app(CoreResourceAction::class),
            deploymentData: app(DeploymentData::class),
            agent: $agent,
            assignedResourceUuid: $agent->resource_uuid,
            runContext: is_array($run->metadata) ? $run->metadata : [],
        );
    }

    private function summarizeToolArgs(array $arguments): string
    {
        if ($arguments === []) {
            return '';
        }

        $json = json_encode($arguments, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

        return mb_substr((string) $json, 0, 160);
    }

    private function summarizeToolResult(array $result): string
    {
        if (isset($result['error'])) {
            return mb_substr((string) $result['error'], 0, 200);
        }

        if (isset($result['message'])) {
            return mb_substr((string) $result['message'], 0, 200);
        }

        $json = json_encode($result, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

        return mb_substr((string) $json, 0, 200);
    }

    private function hideRawToolJson(string $text): string
    {
        if ($text === '') {
            return $text;
        }

        // Nettoyer les balises XML <function=...>...</function> et <tool_call>...</tool_call>
        $cleaned = preg_replace('/<function(?:=|\s+name=)["\']?[^"\'>]+["\']?>[\s\S]*?<\/function>/i', '', $text) ?? $text;
        $cleaned = preg_replace('/<tool_call>[\s\S]*?<\/tool_call>/i', '', $cleaned) ?? $cleaned;
        $cleaned = trim($cleaned);

        if ($cleaned !== '') {
            return $cleaned;
        }

        if (AgentDirectives::extractProseToolCalls($text) === []) {
            return $text;
        }

        $stripped = trim((string) preg_replace('/^\s*\{\}\s*/', '', $text));
        $decoded = json_decode($stripped, true);
        if (is_array($decoded) && (isset($decoded['name']) || isset($decoded['method']) || isset($decoded['tool']))) {
            return 'J’ai exécuté l’action demandée. Dis-moi si tu veux que je continue.';
        }

        return 'J’ai exécuté les actions demandées. Dis-moi si tu veux que je continue.';
    }
}
