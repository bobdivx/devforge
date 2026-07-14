<?php

namespace App\Services\DevForge\Agent\Providers;

use App\Services\DevForge\Agent\Contracts\LlmProvider;
use App\Services\DevForge\Agent\Contracts\LlmResponse;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Sleep;

class GeminiProvider implements LlmProvider
{
    private const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai';

    private const MAX_RETRIES = 3;

    /** @var array<int, int> */
    private const RETRYABLE_STATUS_CODES = [408, 500, 502, 503, 504];

    public function __construct(
        private readonly string $apiKey,
        private readonly string $model = 'gemini-2.5-flash',
        private readonly ?string $baseUrl = null,
    ) {}

    /** {@inheritdoc} */
    public function chat(array $messages, array $tools = []): LlmResponse
    {
        $payload = [
            'model' => $this->normalizeModelId($this->model),
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

            $response = Http::withHeaders([
                'Authorization' => 'Bearer '.$this->apiKey,
                'Accept' => 'application/json',
            ])
                ->timeout(90)
                ->post($this->endpoint('/chat/completions'), $payload);

            if ($response->successful()) {
                return $response;
            }

            $lastResponse = $response;

            if (! in_array($response->status(), self::RETRYABLE_STATUS_CODES, true)) {
                break;
            }
        }

        $status = $lastResponse?->status() ?? 0;

        throw new \RuntimeException($this->formatApiError($status, (string) $lastResponse?->body()));
    }

    private function formatApiError(int $status, string $body): string
    {
        $message = null;

        $decoded = json_decode($body, true);
        if (is_array($decoded)) {
            $message = $decoded['error']['message'] ?? $decoded['message'] ?? null;
        }

        $model = $this->normalizeModelId($this->model);
        $detail = $message ?: mb_substr($body, 0, 300);

        return match ($status) {
            429 => "Gemini [{$model}] [429]: {$detail}",
            404 => "Gemini [{$model}] [404]: modèle indisponible ou non autorisé. {$detail}",
            400 => "Gemini [{$model}] [400]: requête refusée. {$detail}",
            503 => "Gemini [{$model}] [503]: modèle temporairement surchargé. {$detail}",
            default => "Gemini [{$model}] [{$status}]: {$detail}",
        };
    }

    public function testConnection(): bool
    {
        try {
            $response = Http::withHeaders([
                'Authorization' => 'Bearer '.$this->apiKey,
                'Accept' => 'application/json',
            ])
                ->timeout(10)
                ->get($this->endpoint('/models'));

            return $response->successful();
        } catch (ConnectionException) {
            return false;
        }
    }

    /**
     * @param  array<int, array<string, mixed>>  $messages
     * @return array<int, array<string, mixed>>
     */
    private function formatMessages(array $messages): array
    {
        return array_values(array_map(function (array $message): array {
            $formatted = [
                'role' => $message['role'],
                'content' => is_string($message['content'])
                    ? $message['content']
                    : json_encode($message['content'], JSON_UNESCAPED_UNICODE),
            ];

            if (! empty($message['tool_calls'])) {
                $formatted['tool_calls'] = $message['tool_calls'];
            }

            if (! empty($message['tool_call_id'])) {
                $formatted['tool_call_id'] = $message['tool_call_id'];
            }

            return $formatted;
        }, $messages));
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
                'extra_content' => is_array($call['extra_content'] ?? null) ? $call['extra_content'] : null,
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

    private function endpoint(string $path): string
    {
        return rtrim($this->resolvedBaseUrl(), '/').'/'.ltrim($path, '/');
    }

    private function resolvedBaseUrl(): string
    {
        $baseUrl = trim((string) ($this->baseUrl ?: self::DEFAULT_BASE_URL));

        return rtrim($baseUrl, '/');
    }

    private function normalizeModelId(string $model): string
    {
        return preg_replace('/^models\//i', '', trim($model)) ?? trim($model);
    }
}
