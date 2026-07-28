<?php

namespace App\Services\DevForge\Agent\Providers;

use App\Services\DevForge\Agent\AgentToolResultEncoder;
use App\Services\DevForge\Agent\Contracts\LlmProvider;
use App\Services\DevForge\Agent\Contracts\LlmResponse;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Sleep;

/**
 * Anthropic Messages API — convertit le format OpenAI-like de DevForge.
 */
class AnthropicProvider implements LlmProvider
{
    private const DEFAULT_BASE_URL = 'https://api.anthropic.com/v1';

    private const MAX_RETRIES = 3;

    /** @var array<int, int> */
    private const RETRYABLE_STATUS_CODES = [408, 429, 500, 502, 503, 504];

    public function __construct(
        private readonly string $apiKey,
        private readonly string $model = 'claude-sonnet-4-20250514',
        private readonly ?string $baseUrl = null,
    ) {}

    public function chat(array $messages, array $tools = []): LlmResponse
    {
        [$system, $anthropicMessages] = $this->toAnthropicMessages($messages);

        $payload = [
            'model' => trim($this->model),
            'max_tokens' => 8192,
            'messages' => $anthropicMessages,
        ];

        if ($system !== '') {
            $payload['system'] = $system;
        }

        if ($tools !== []) {
            $payload['tools'] = array_values(array_map(fn (array $tool): array => [
                'name' => $tool['name'],
                'description' => $tool['description'],
                    'input_schema' => $tool['parameters'] ?: ['type' => 'object', 'properties' => (object) []],
            ], $tools));
        }

        $response = $this->sendWithRetries($payload);

        return $this->parseResponse($response->json());
    }

    public function testConnection(): bool
    {
        try {
            $response = Http::withHeaders($this->headers())
                ->timeout(15)
                ->get(rtrim($this->resolvedBaseUrl(), '/').'/models');

            return $response->successful();
        } catch (ConnectionException) {
            return false;
        }
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    private function sendWithRetries(array $payload): \Illuminate\Http\Client\Response
    {
        $lastResponse = null;

        for ($attempt = 0; $attempt <= self::MAX_RETRIES; $attempt++) {
            if ($attempt > 0) {
                Sleep::sleep(2 ** $attempt);
            }

            $response = Http::withHeaders($this->headers())
                ->timeout(120)
                ->post(rtrim($this->resolvedBaseUrl(), '/').'/messages', $payload);

            if ($response->successful()) {
                return $response;
            }

            $lastResponse = $response;

            if (! in_array($response->status(), self::RETRYABLE_STATUS_CODES, true)) {
                break;
            }
        }

        $status = $lastResponse?->status() ?? 0;
        $body = (string) $lastResponse?->body();
        $decoded = json_decode($body, true);
        $detail = is_array($decoded)
            ? (string) ($decoded['error']['message'] ?? $decoded['message'] ?? mb_substr($body, 0, 300))
            : mb_substr($body, 0, 300);

        throw new \RuntimeException("anthropic [{$this->model}] [{$status}]: {$detail}");
    }

    /** @return array<string, string> */
    private function headers(): array
    {
        return [
            'x-api-key' => $this->apiKey,
            'anthropic-version' => '2023-06-01',
            'Accept' => 'application/json',
            'Content-Type' => 'application/json',
        ];
    }

    /**
     * @param  array<int, array<string, mixed>>  $messages
     * @return array{0: string, 1: list<array<string, mixed>>}
     */
    private function toAnthropicMessages(array $messages): array
    {
        $systemParts = [];
        $converted = [];

        foreach ($messages as $message) {
            $role = (string) ($message['role'] ?? 'user');

            if ($role === 'system') {
                $systemParts[] = is_string($message['content'] ?? null)
                    ? (string) $message['content']
                    : (json_encode($message['content'] ?? '', JSON_UNESCAPED_UNICODE) ?: '');

                continue;
            }

            if ($role === 'assistant' && ! empty($message['tool_calls']) && is_array($message['tool_calls'])) {
                $content = [];
                $text = trim((string) ($message['content'] ?? ''));
                if ($text !== '') {
                    $content[] = ['type' => 'text', 'text' => $text];
                }
                foreach ($message['tool_calls'] as $call) {
                    $fn = $call['function'] ?? [];
                    $args = $fn['arguments'] ?? [];
                    if (is_string($args)) {
                        $args = json_decode($args, true) ?? [];
                    }
                    $content[] = [
                        'type' => 'tool_use',
                        'id' => (string) ($call['id'] ?? ''),
                        'name' => (string) ($fn['name'] ?? ''),
                        'input' => is_array($args) ? $args : new \stdClass,
                    ];
                }
                $converted[] = ['role' => 'assistant', 'content' => $content];

                continue;
            }

            if ($role === 'tool') {
                $toolContent = is_string($message['content'] ?? null)
                    ? (string) $message['content']
                    : (json_encode($message['content'] ?? '', JSON_UNESCAPED_UNICODE) ?: '');

                if (strlen($toolContent) > AgentToolResultEncoder::MAX_BYTES) {
                    $toolContent = AgentToolResultEncoder::encode(
                        json_decode($toolContent, true) ?? ['raw' => $toolContent],
                    );
                }

                $block = [
                    'type' => 'tool_result',
                    'tool_use_id' => (string) ($message['tool_call_id'] ?? ''),
                    'content' => $toolContent,
                ];

                $last = $converted[array_key_last($converted)] ?? null;
                if (is_array($last) && ($last['role'] ?? '') === 'user' && is_array($last['content'] ?? null)) {
                    $converted[array_key_last($converted)]['content'][] = $block;
                } else {
                    $converted[] = ['role' => 'user', 'content' => [$block]];
                }

                continue;
            }

            $text = is_string($message['content'] ?? null)
                ? (string) $message['content']
                : (json_encode($message['content'] ?? '', JSON_UNESCAPED_UNICODE) ?: '');

            $converted[] = [
                'role' => $role === 'assistant' ? 'assistant' : 'user',
                'content' => $text,
            ];
        }

        return [trim(implode("\n\n", array_filter($systemParts))), array_values($converted)];
    }

    /** @param array<mixed> $data */
    private function parseResponse(array $data): LlmResponse
    {
        $text = '';
        $toolCalls = [];

        foreach ($data['content'] ?? [] as $block) {
            if (! is_array($block)) {
                continue;
            }
            if (($block['type'] ?? '') === 'text') {
                $text .= (string) ($block['text'] ?? '');
            }
            if (($block['type'] ?? '') === 'tool_use') {
                $toolCalls[] = [
                    'id' => (string) ($block['id'] ?? ''),
                    'name' => (string) ($block['name'] ?? ''),
                    'arguments' => is_array($block['input'] ?? null) ? $block['input'] : [],
                ];
            }
        }

        $stopReason = (string) ($data['stop_reason'] ?? 'end_turn');
        $usage = is_array($data['usage'] ?? null) ? $data['usage'] : [];
        $tokensUsed = (int) ($usage['input_tokens'] ?? 0) + (int) ($usage['output_tokens'] ?? 0);

        return new LlmResponse(
            text: $text,
            toolCalls: $toolCalls,
            tokensUsed: $tokensUsed,
            isFinished: count($toolCalls) === 0 && in_array($stopReason, ['end_turn', 'max_tokens', 'stop_sequence'], true),
        );
    }

    private function resolvedBaseUrl(): string
    {
        $base = trim((string) ($this->baseUrl ?: self::DEFAULT_BASE_URL));

        return rtrim($base, '/');
    }
}
