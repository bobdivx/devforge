<?php

namespace App\Services\DevForge\Agent\Providers;

use App\Services\DevForge\Agent\Contracts\LlmProvider;
use App\Services\DevForge\Agent\Contracts\LlmResponse;
use App\Services\DevForge\Agent\LlmModelResolver;
use App\Services\DevForge\Agent\OllamaMessageNormalizer;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;

class OllamaProvider implements LlmProvider
{
    public function __construct(
        private readonly string $baseUrl,
        private readonly string $model = 'llama3.2',
    ) {}

    public function model(): string
    {
        return $this->model;
    }

    /** {@inheritdoc} */
    public function chat(array $messages, array $tools = []): LlmResponse
    {
        $payload = [
            'model' => $this->model,
            'messages' => OllamaMessageNormalizer::formatMessages($messages),
            'stream' => false,
        ];

        if (count($tools) > 0 && ! LlmModelResolver::isToolCallingOllamaModel($this->model)) {
            throw new \RuntimeException(
                "Le modèle Ollama « {$this->model} » ne supporte pas les outils. Utilisez llama3.2 ou qwen2.5."
            );
        }

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

    /** @param array<mixed> $data */
    private function parseResponse(array $data): LlmResponse
    {
        $message = $data['message'] ?? [];
        $toolCalls = [];

        foreach ($message['tool_calls'] ?? [] as $call) {
            $fn = $call['function'] ?? [];

            $toolCalls[] = [
                'id' => (string) ($call['id'] ?? 'call_'.uniqid()),
                'name' => $fn['name'] ?? '',
                'arguments' => OllamaMessageNormalizer::normalizeToolArguments($fn['arguments'] ?? []),
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
