<?php

namespace App\Services\DevForge\Agent\Providers;

use App\Services\DevForge\Agent\AgentToolResultEncoder;
use App\Services\DevForge\Agent\Contracts\LlmProvider;
use App\Services\DevForge\Agent\Contracts\LlmResponse;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Sleep;

/**
 * Provider OpenAI-compatible (OpenAI, OpenRouter, et endpoints compatibles).
 */
class OpenAiCompatibleProvider implements LlmProvider
{
    private const MAX_RETRIES = 3;

    /** @var array<int, int> */
    private const RETRYABLE_STATUS_CODES = [408, 429, 500, 502, 503, 504];

    public function __construct(
        private readonly string $apiKey,
        private readonly string $model,
        private readonly string $baseUrl,
        private readonly string $label = 'openai',
        /** @var array<string, string> */
        private readonly array $extraHeaders = [],
    ) {}

    public function chat(array $messages, array $tools = []): LlmResponse
    {
        $payload = [
            'model' => trim($this->model),
            'messages' => $this->formatMessages($messages),
        ];

        if (count($tools) > 0) {
            $payload['tools'] = array_values(array_map(fn (array $tool): array => [
                'type' => 'function',
                'function' => [
                    'name' => $tool['name'],
                    'description' => $tool['description'],
                    'parameters' => $tool['parameters'],
                ],
            ], $tools));
        }

        $response = $this->sendWithRetries($payload);

        return $this->parseResponse($response->json());
    }

    public function testConnection(): bool
    {
        $urls = $this->candidateUrls('/models');

        foreach ($urls as $url) {
            try {
                $response = Http::withHeaders($this->headers())
                    ->timeout(15)
                    ->get($url);

                if ($response->successful()) {
                    return true;
                }
            } catch (ConnectionException) {
                // Try next candidate URL.
            }
        }

        return false;
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    private function sendWithRetries(array $payload): Response
    {
        $chatUrls = $this->candidateUrls('/chat/completions');
        $lastResponse = null;

        for ($attempt = 0; $attempt <= self::MAX_RETRIES; $attempt++) {
            if ($attempt > 0) {
                Sleep::sleep(2 ** $attempt);
            }

            foreach ($chatUrls as $url) {
                $response = Http::withHeaders($this->headers())
                    ->timeout(120)
                    ->post($url, $payload);

                if ($response->successful()) {
                    return $response;
                }

                $lastResponse = $response;

                // Si le chemin retourne 404, on passe à l'URL candidate suivante sans attendre.
                if ($response->status() !== 404) {
                    break;
                }
            }

            if ($lastResponse && ! in_array($lastResponse->status(), self::RETRYABLE_STATUS_CODES, true)) {
                break;
            }
        }

        $status = $lastResponse?->status() ?? 0;
        $body = (string) $lastResponse?->body();
        $decoded = json_decode($body, true);
        $detail = is_array($decoded)
            ? (string) ($decoded['error']['message'] ?? $decoded['message'] ?? mb_substr($body, 0, 300))
            : mb_substr($body, 0, 300);

        throw new \RuntimeException("{$this->label} [{$this->model}] [{$status}]: {$detail}");
    }

    /**
     * @return array<int, string>
     */
    private function candidateUrls(string $path): array
    {
        $clean = rtrim($this->baseUrl, '/');
        $urls = [];

        if (str_ends_with($clean, '/v1')) {
            $urls[] = $clean.$path;
            $parent = preg_replace('#/v1$#', '', $clean) ?? $clean;
            $urls[] = $parent.$path;
        } else {
            $urls[] = $clean.$path;
            $urls[] = $clean.'/v1'.$path;
        }

        return array_values(array_unique($urls));
    }

    /** @return array<string, string> */
    private function headers(): array
    {
        $key = trim($this->apiKey);
        if ($key === '') {
            $key = 'sk-local-devforge';
        }

        return array_merge([
            'Authorization' => 'Bearer '.$key,
            'Accept' => 'application/json',
            'Content-Type' => 'application/json',
        ], $this->extraHeaders);
    }

    /**
     * @param  array<int, array<string, mixed>>  $messages
     * @return array<int, array<string, mixed>>
     */
    private function formatMessages(array $messages): array
    {
        return array_values(array_map(function (array $message): array {
            $role = (string) ($message['role'] ?? 'user');
            $hasToolCalls = ! empty($message['tool_calls']) && is_array($message['tool_calls']);

            $formatted = [
                'role' => $role,
                'content' => $this->formatMessageContent($message['content'] ?? '', $role),
            ];

            if ($hasToolCalls && ($formatted['content'] === '' || $formatted['content'] === null)) {
                unset($formatted['content']);
            }

            if ($hasToolCalls) {
                $formatted['tool_calls'] = $message['tool_calls'];
            }

            if (! empty($message['tool_call_id'])) {
                $formatted['tool_call_id'] = $message['tool_call_id'];
            }

            if (! empty($message['name']) && $role === 'tool') {
                $formatted['name'] = (string) $message['name'];
            }

            return $formatted;
        }, $messages));
    }

    private function formatMessageContent(mixed $content, string $role): ?string
    {
        if ($role === 'tool') {
            $text = is_string($content) ? $content : (json_encode($content, JSON_UNESCAPED_UNICODE) ?: '');

            if (strlen($text) <= AgentToolResultEncoder::MAX_BYTES) {
                return $text;
            }

            return AgentToolResultEncoder::encode(json_decode($text, true) ?? ['raw' => $text]);
        }

        if (is_string($content)) {
            return $content;
        }

        return json_encode($content, JSON_UNESCAPED_UNICODE) ?: '';
    }

    /** @param array<mixed> $data */
    private function parseResponse(array $data): LlmResponse
    {
        $choice = $data['choices'][0] ?? [];
        $message = $choice['message'] ?? [];
        $text = (string) ($message['content'] ?? '');
        $toolCalls = [];

        foreach ($message['tool_calls'] ?? [] as $call) {
            $function = $call['function'] ?? [];
            $arguments = $function['arguments'] ?? [];

            if (is_string($arguments)) {
                $arguments = json_decode($arguments, true) ?? [];
            }

            $toolCalls[] = [
                'id' => (string) ($call['id'] ?? ''),
                'name' => (string) ($function['name'] ?? ''),
                'arguments' => is_array($arguments) ? $arguments : [],
            ];
        }

        $finishReason = (string) ($choice['finish_reason'] ?? 'stop');
        $tokensUsed = (int) ($data['usage']['total_tokens'] ?? 0);

        return new LlmResponse(
            text: $text,
            toolCalls: $toolCalls,
            tokensUsed: $tokensUsed,
            isFinished: count($toolCalls) === 0 && in_array($finishReason, ['stop', 'length'], true),
        );
    }
}
