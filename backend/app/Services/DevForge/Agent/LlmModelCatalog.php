<?php

namespace App\Services\DevForge\Agent;

use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;

class LlmModelCatalog
{
    /**
     * @return array<int, array{id: string, label: string, description: string|null}>
     */
    public function listForProvider(string $provider, ?string $apiKey = null, ?string $baseUrl = null): array
    {
        return match ($provider) {
            'gemini' => $this->listGeminiModels(
                $apiKey ?? throw new \InvalidArgumentException('Clé API Gemini requise.'),
                $baseUrl,
            ),
            'ollama' => $this->listOllamaModels($baseUrl ?? throw new \InvalidArgumentException('URL Ollama requise.')),
            'openai', 'openrouter' => $this->listOpenAiCompatibleModels(
                $provider,
                $apiKey ?? throw new \InvalidArgumentException("Clé API {$provider} requise."),
                $baseUrl,
            ),
            'anthropic' => $this->listAnthropicModels(
                $apiKey ?? throw new \InvalidArgumentException('Clé API Anthropic requise.'),
                $baseUrl,
            ),
            default => throw new \InvalidArgumentException("Provider {$provider} non supporté."),
        };
    }

    /**
     * @return array<int, array{id: string, label: string, description: string|null}>
     */
    private function listGeminiModels(string $apiKey, ?string $baseUrl = null): array
    {
        $resolvedBaseUrl = rtrim($baseUrl ?: 'https://generativelanguage.googleapis.com/v1beta/openai', '/');

        $response = Http::withHeaders([
            'Authorization' => 'Bearer '.$apiKey,
            'Accept' => 'application/json',
        ])
            ->connectTimeout(5)
            ->timeout(15)
            ->get("{$resolvedBaseUrl}/models");

        if ($response->failed()) {
            throw new \RuntimeException("Impossible de récupérer les modèles Gemini [{$response->status()}].");
        }

        return collect($response->json('data', []))
            ->map(function (array $model): array {
                $id = preg_replace('/^models\//i', '', (string) ($model['id'] ?? '')) ?? '';

                return [
                    'id' => $id,
                    'label' => $id,
                    'description' => isset($model['owned_by']) ? (string) $model['owned_by'] : null,
                ];
            })
            ->filter(fn (array $model): bool => $model['id'] !== ''
                && LlmModelResolver::isChatCompatibleGeminiModel($model['id']))
            ->sortBy('label', SORT_NATURAL | SORT_FLAG_CASE)
            ->values()
            ->all();
    }

    /**
     * @return array<int, array{id: string, label: string, description: string|null}>
     */
    private function listOllamaModels(string $baseUrl): array
    {
        try {
            $response = Http::timeout(10)->get(rtrim($baseUrl, '/').'/api/tags');
        } catch (ConnectionException) {
            throw new \RuntimeException('Impossible de joindre le serveur Ollama.');
        }

        if ($response->failed()) {
            throw new \RuntimeException("Impossible de récupérer les modèles Ollama [{$response->status()}].");
        }

        return collect($response->json('models', []))
            ->map(fn (array $model): array => [
                'id' => (string) ($model['name'] ?? ''),
                'label' => (string) ($model['name'] ?? ''),
                'description' => isset($model['details']['family']) ? (string) $model['details']['family'] : null,
            ])
            ->filter(fn (array $model): bool => $model['id'] !== ''
                && LlmModelResolver::isToolCallingOllamaModel($model['id']))
            ->sortBy('label', SORT_NATURAL | SORT_FLAG_CASE)
            ->values()
            ->all();
    }

    /**
     * @return array<int, array{id: string, label: string, description: string|null}>
     */
    private function listOpenAiCompatibleModels(string $provider, string $apiKey, ?string $baseUrl = null): array
    {
        $resolvedBaseUrl = LlmEndpointResolver::openAiCompatibleBaseUrl($provider, $baseUrl);
        $headers = [
            'Authorization' => 'Bearer '.$apiKey,
            'Accept' => 'application/json',
        ];

        if ($provider === 'openrouter') {
            $headers['HTTP-Referer'] = (string) config('app.url', 'https://github.com/bobdivx/devforge');
            $headers['X-Title'] = 'DevForge';
        }

        $response = Http::withHeaders($headers)
            ->connectTimeout(5)
            ->timeout(20)
            ->get("{$resolvedBaseUrl}/models");

        if ($response->failed()) {
            throw new \RuntimeException("Impossible de récupérer les modèles {$provider} [{$response->status()}].");
        }

        return collect($response->json('data', []))
            ->map(function (array $model): array {
                $id = (string) ($model['id'] ?? '');

                return [
                    'id' => $id,
                    'label' => $id,
                    'description' => isset($model['owned_by'])
                        ? (string) $model['owned_by']
                        : (isset($model['name']) ? (string) $model['name'] : null),
                ];
            })
            ->filter(fn (array $model): bool => $model['id'] !== '')
            ->sortBy('label', SORT_NATURAL | SORT_FLAG_CASE)
            ->values()
            ->all();
    }

    /**
     * @return array<int, array{id: string, label: string, description: string|null}>
     */
    private function listAnthropicModels(string $apiKey, ?string $baseUrl = null): array
    {
        $resolvedBaseUrl = LlmEndpointResolver::anthropicBaseUrl($baseUrl);

        $response = Http::withHeaders([
            'x-api-key' => $apiKey,
            'anthropic-version' => '2023-06-01',
            'Accept' => 'application/json',
        ])
            ->connectTimeout(5)
            ->timeout(20)
            ->get("{$resolvedBaseUrl}/models");

        if ($response->failed()) {
            // Catalogue minimal si l'endpoint models n'est pas dispo.
            return [
                ['id' => 'claude-sonnet-4-20250514', 'label' => 'claude-sonnet-4-20250514', 'description' => 'Anthropic'],
                ['id' => 'claude-3-5-haiku-latest', 'label' => 'claude-3-5-haiku-latest', 'description' => 'Anthropic'],
                ['id' => 'claude-opus-4-20250514', 'label' => 'claude-opus-4-20250514', 'description' => 'Anthropic'],
            ];
        }

        return collect($response->json('data', []))
            ->map(function (array $model): array {
                $id = (string) ($model['id'] ?? '');

                return [
                    'id' => $id,
                    'label' => (string) ($model['display_name'] ?? $id),
                    'description' => 'Anthropic',
                ];
            })
            ->filter(fn (array $model): bool => $model['id'] !== '')
            ->sortBy('label', SORT_NATURAL | SORT_FLAG_CASE)
            ->values()
            ->all();
    }
}
