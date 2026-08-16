<?php

namespace App\Services\DevForge\Agent;

use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;

/**
 * Détecte un serveur Ollama joignable depuis le conteneur DevForge (fallback agents).
 */
class OllamaFallbackResolver
{
    /**
     * @return array{base_url: string, model: string}|null
     */
    public function discover(): ?array
    {
        foreach ($this->candidateBaseUrls() as $baseUrl) {
            $models = $this->listModels($baseUrl);

            if ($models === null) {
                continue;
            }

            $model = LlmModelResolver::pickBestOllamaModelForTools($models);

            if ($model === null) {
                continue;
            }

            return [
                'base_url' => $baseUrl,
                'model' => $model,
            ];
        }

        return null;
    }

    public function isReachable(string $baseUrl): bool
    {
        return $this->listModels($baseUrl) !== null;
    }

    /** @return array<int, string> */
    private function candidateBaseUrls(): array
    {
        $candidates = [];

        $configured = trim((string) config('devforge.ollama_url', ''));

        if ($configured !== '') {
            $candidates[] = rtrim($configured, '/');
        }

        foreach ([
            'http://host.docker.internal:11434',
            'http://172.17.0.1:11434',
            'http://127.0.0.1:11434',
        ] as $url) {
            $candidates[] = $url;
        }

        $hostIp = trim((string) config('devforge.ollama_host_ip', ''));

        if ($hostIp !== '') {
            $candidates[] = "http://{$hostIp}:11434";
        }

        return array_values(array_unique($candidates));
    }

    /**
     * @return array<int, string>|null
     */
    private function listModels(string $baseUrl): ?array
    {
        try {
            $response = Http::connectTimeout(1)->timeout(2)->get(rtrim($baseUrl, '/').'/api/tags');

            if (! $response->successful()) {
                return null;
            }

            $models = collect($response->json('models', []))
                ->pluck('name')
                ->filter(fn ($name): bool => is_string($name) && $name !== '')
                ->values()
                ->all();

            return $models !== [] ? $models : null;
        } catch (ConnectionException) {
            return null;
        }
    }
}
