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
}
