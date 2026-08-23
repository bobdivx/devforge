<?php

namespace App\Services\DevForge\Agent\Providers;

use App\Services\DevForge\Agent\AgentToolResultEncoder;
use App\Services\DevForge\Agent\Contracts\LlmProvider;
use App\Services\DevForge\Agent\Contracts\LlmResponse;
use App\Services\DevForge\Agent\GeminiThoughtSignature;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Sleep;

class GeminiProvider implements LlmProvider
{
    private const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai';

    private const MAX_RETRIES = 3;

    /** @var array<int, int> */
    private const RETRYABLE_STATUS_CODES = [408, 429, 500, 502, 503, 504];

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
    private function sendWithRetries(array $payload): Response
    {
        $lastResponse = null;

        for ($attempt = 0; $attempt <= self::MAX_RETRIES; $attempt++) {
            if ($attempt > 0) {
                Sleep::sleep($this->retryDelaySeconds($attempt, $lastResponse));
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

    private function retryDelaySeconds(int $attempt, ?Response $lastResponse): int
    {
        if ($lastResponse?->status() === 429) {
            $retryAfter = (int) ($lastResponse->header('Retry-After') ?: 0);
            if ($retryAfter > 0) {
                return min(60, max(2, $retryAfter));
            }

            // RPM/TPM Gemini : backoff plus long que les 5xx classiques.
            return min(45, 5 * (2 ** ($attempt - 1)));
        }

        return 2 ** $attempt;
    }

    private function formatApiError(int $status, string $body): string
    {
        $message = null;
        $metric = null;

        $decoded = json_decode($body, true);
        if (is_array($decoded)) {
            // Parfois un tableau d'erreurs (proxy / OpenAI-compat).
            if (array_is_list($decoded) && isset($decoded[0]) && is_array($decoded[0])) {
                $decoded = $decoded[0];
            }

            $error = is_array($decoded['error'] ?? null) ? $decoded['error'] : null;
            $message = $error['message'] ?? $decoded['message'] ?? null;
            $details = $error['details'] ?? [];
            if (is_array($details)) {
                foreach ($details as $detail) {
                    if (! is_array($detail)) {
                        continue;
                    }
                    $candidate = $detail['metadata']['quota_metric']
                        ?? $detail['metadata']['quotaMetric']
                        ?? $detail['quotaMetric']
                        ?? null;
                    if (is_string($candidate) && $candidate !== '') {
                        $metric = $candidate;
                        break;
                    }
                }
            }
        }

        $model = $this->normalizeModelId($this->model);
        $detail = is_string($message) && $message !== '' ? $message : mb_substr($body, 0, 300);

        return match ($status) {
            429 => $this->formatRateLimitError($model, $detail, $metric),
            404 => "Gemini [{$model}] [404]: modèle indisponible ou non autorisé. {$detail}",
            400 => "Gemini [{$model}] [400]: requête refusée. {$detail}",
            503 => "Gemini [{$model}] [503]: modèle temporairement surchargé. {$detail}",
            default => "Gemini [{$model}] [{$status}]: {$detail}",
        };
    }

    private function formatRateLimitError(string $model, string $detail, ?string $metric): string
    {
        $hint = 'Limite de débit / quota projet Google (RPM, TPM ou RPD) — pas forcément un crédit à 0. '
            .'Vérifie AI Studio → Rate limit pour la clé/projet utilisés par DevForge, '
            .'et que la facturation est bien liée à ce projet.';

        if (is_string($metric) && $metric !== '') {
            $hint .= " Métrique: {$metric}.";
        }

        return "Gemini [{$model}] [429]: {$detail} {$hint}";
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
            $role = (string) ($message['role'] ?? 'user');
            $hasToolCalls = ! empty($message['tool_calls']) && is_array($message['tool_calls']);

            $formatted = [
                'role' => $role,
                'content' => $this->formatMessageContent($message['content'] ?? '', $role),
            ];

            // Messages assistant avec tool_calls : content peut être vide/null
            if ($hasToolCalls && ($formatted['content'] === '' || $formatted['content'] === null)) {
                unset($formatted['content']);
            }

            // Messages tool : content DOIT être présent et non-vide (Gemini OpenAI-compat)
            if ($role === 'tool' && ($formatted['content'] === '' || $formatted['content'] === null)) {
                $formatted['content'] = '{}';
            }

            if ($hasToolCalls) {
                $formatted['tool_calls'] = GeminiThoughtSignature::ensureOnToolCalls($message['tool_calls']);
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
            $text = is_string($content) ? $content : (json_encode($content, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR) ?: '{}');

            // Gemini OpenAI-compat exige un content non-vide pour role=tool
            if ($text === '' || $text === null) {
                return '{}';
            }

            return $this->truncateToolContent($text);
        }

        if (is_string($content)) {
            return $content !== '' ? $content : null;
        }

        if ($content === null || $content === []) {
            return null;
        }

        return json_encode($content, JSON_UNESCAPED_UNICODE) ?: null;
    }

    private function truncateToolContent(string $content): string
    {
        if (strlen($content) <= AgentToolResultEncoder::MAX_BYTES) {
            return $content;
        }

        return AgentToolResultEncoder::encode(json_decode($content, true) ?? ['raw' => $content]);
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
