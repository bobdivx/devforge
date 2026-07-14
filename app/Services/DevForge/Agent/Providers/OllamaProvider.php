<?php

namespace App\Services\DevForge\Agent\Providers;

use App\Services\DevForge\Agent\Contracts\LlmProvider;
use App\Services\DevForge\Agent\Contracts\LlmResponse;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;

class OllamaProvider implements LlmProvider
{
    public function __construct(
        private readonly string $baseUrl,
        private readonly string $model = 'llama3.2',
    ) {}

    /** {@inheritdoc} */
    public function chat(array $messages, array $tools = []): LlmResponse
    {
        $payload = [
            'model' => $this->model,
            'messages' => $this->formatMessages($messages),
            'stream' => false,
        ];

        if (count($tools) > 0) {
            $payload['tools'] = array_map(fn ($t) => [
                'type' => 'function',
                'function' => [
                    'name' => $t['name'],
                    'description' => $t['description'],
                    'parameters' => $t['parameters'],
                ],
            ], $tools);
        }

        $response = Http::timeout(120)
            ->post(rtrim($this->baseUrl, '/').'/api/chat', $payload);

        if ($response->failed()) {
            throw new \RuntimeException("Ollama API error [{$response->status()}]: ".$response->body());
        }

        return $this->parseResponse($response->json());
    }

    public function testConnection(): bool
    {
        try {
            $response = Http::timeout(5)->get(rtrim($this->baseUrl, '/').'/api/tags');

            return $response->successful();
        } catch (ConnectionException) {
            return false;
        }
    }

    /**
     * @param  array<array{role: string, content: string|array<mixed>}>  $messages
     * @return array<mixed>
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

            if (! empty($message['tool_calls']) && is_array($message['tool_calls'])) {
                $formatted['tool_calls'] = array_values(array_map(function (array $call): array {
                    $function = $call['function'] ?? [];
                    $arguments = $function['arguments'] ?? [];

                    if (is_string($arguments)) {
                        $decoded = json_decode($arguments, true);
                        $arguments = is_array($decoded) ? $decoded : [];
                    }

                    return [
                        'function' => [
                            'name' => (string) ($function['name'] ?? ''),
                            'arguments' => $arguments,
                        ],
                    ];
                }, $message['tool_calls']));
            }

            if (($message['role'] ?? '') === 'tool') {
                $formatted['role'] = 'tool';
            }

            return $formatted;
        }, $messages));
    }

    /** @param array<mixed> $data */
    private function parseResponse(array $data): LlmResponse
    {
        $message = $data['message'] ?? [];
        $toolCalls = [];

        foreach ($message['tool_calls'] ?? [] as $call) {
            $fn = $call['function'] ?? [];
            $arguments = $fn['arguments'] ?? [];

            if (is_string($arguments)) {
                $arguments = json_decode($arguments, true) ?? [];
            }

            $toolCalls[] = [
                'id' => (string) ($call['id'] ?? 'call_'.uniqid()),
                'name' => $fn['name'] ?? '',
                'arguments' => is_array($arguments) ? $arguments : [],
            ];
        }

        $tokensUsed = ($data['prompt_eval_count'] ?? 0) + ($data['eval_count'] ?? 0);

        return new LlmResponse(
            text: $message['content'] ?? '',
            toolCalls: $toolCalls,
            tokensUsed: $tokensUsed,
            isFinished: ($data['done'] ?? false),
        );
    }
}
