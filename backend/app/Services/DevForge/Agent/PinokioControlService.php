<?php

namespace App\Services\DevForge\Agent;

use App\Models\AiProviderConfig;
use App\Models\Team;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;
use Throwable;

/**
 * Service de contrôle à distance pour Pinokio Uncensored Local Studio (serve.cjs).
 * Permet de lister les modèles GGUF, charger/décharger en VRAM GPU et inspecter la télémétrie.
 */
class PinokioControlService
{
    private const HTTP_TIMEOUT = 10;

    /**
     * @return list<array{
     *     id: int,
     *     name: string,
     *     base_url: string|null,
     *     resolved_base_url: string|null,
     *     is_default: bool,
     *     model: string|null,
     *     reachable: bool
     * }>
     */
    public function listInstances(Team $team): array
    {
        return AiProviderConfig::query()
            ->where('team_id', $team->id)
            ->whereIn('provider', ['openai', 'local', 'pinokio'])
            ->orderByDesc('is_default')
            ->orderBy('name')
            ->get()
            ->filter(fn (AiProviderConfig $provider): bool => $this->looksLikePinokioProvider($provider))
            ->map(function (AiProviderConfig $provider): array {
                $baseUrl = (string) ($provider->base_url ?? '');
                $resolved = $this->normalizeBaseUrl($baseUrl);

                return [
                    'id' => $provider->id,
                    'name' => $this->displayName($provider),
                    'base_url' => $provider->base_url,
                    'resolved_base_url' => $resolved,
                    'is_default' => (bool) $provider->is_default,
                    'model' => $provider->model,
                    'reachable' => $resolved !== null && $this->isReachable($resolved),
                ];
            })
            ->values()
            ->all();
    }

    /**
     * Détecte un studio Pinokio / Demeter (RTX 3090) même si le provider est typé openai.
     */
    public function looksLikePinokioProvider(AiProviderConfig $provider): bool
    {
        $url = strtolower((string) ($provider->base_url ?? ''));
        $name = strtolower((string) $provider->name);

        if ($url !== '' && (
            str_contains($url, ':10086')
            || str_contains($url, ':42031')
            || str_contains($url, '10.1.0.88')
        )) {
            return true;
        }

        foreach (['pinokio', 'demeter', 'local studio', 'uncensored'] as $needle) {
            if (str_contains($name, $needle)) {
                return true;
            }
        }

        return false;
    }

    private function displayName(AiProviderConfig $provider): string
    {
        $name = trim((string) $provider->name);
        $url = strtolower((string) ($provider->base_url ?? ''));
        $nameLower = strtolower($name);

        if (str_contains($nameLower, 'demeter')) {
            return $name !== '' ? $name : 'Demeter';
        }

        if (str_contains($url, '10.1.0.88') || str_contains($url, ':10086')) {
            if ($name === '' || in_array($nameLower, ['qwen3', 'openai', 'auto', 'local'], true)) {
                return 'Demeter (RTX 3090)';
            }

            if (! str_contains($nameLower, 'demeter') && ! str_contains($nameLower, '3090')) {
                return "{$name} · Demeter";
            }
        }

        return $name !== '' ? $name : 'Pinokio';
    }

    /**
     * @return array{
     *     reachable: bool,
     *     base_url: string|null,
     *     active_model: string|null,
     *     running: bool,
     *     context_size: int|null,
     *     backend_mode: string|null,
     *     gpu: array{name: string, vram_used_gb: float, vram_total_gb: float}|null,
     *     models: list<array{filename: string, name: string, size: string, size_bytes: int, is_active: bool}>,
     *     error: string|null
     * }
     */
    public function status(string $baseUrl): array
    {
        $normalizedUrl = $this->normalizeBaseUrl($baseUrl);
        if ($normalizedUrl === null) {
            return [
                'reachable' => false,
                'base_url' => $baseUrl,
                'active_model' => null,
                'running' => false,
                'context_size' => null,
                'backend_mode' => null,
                'gpu' => null,
                'models' => [],
                'error' => 'URL Pinokio invalide.',
            ];
        }

        try {
            // 1. Récupérer la télémétrie et l'état du serveur
            $healthRes = Http::timeout(self::HTTP_TIMEOUT)->get("{$normalizedUrl}/api/health");
            $telemetryRes = Http::timeout(self::HTTP_TIMEOUT)->get("{$normalizedUrl}/api/telemetry");
            $modelsRes = Http::timeout(self::HTTP_TIMEOUT)->get("{$normalizedUrl}/api/llm/models");

            $health = $healthRes->successful() ? $healthRes->json() : [];
            $telemetry = $telemetryRes->successful() ? $telemetryRes->json() : [];
            $modelsData = $modelsRes->successful() ? $modelsRes->json() : [];

            $backendInfo = is_array($health['backend'] ?? null) ? $health['backend'] : [];
            $settings = is_array($backendInfo['settings'] ?? null) ? $backendInfo['settings'] : [];
            $activeModel = is_string($settings['model'] ?? null) ? basename($settings['model']) : null;

            // Si /api/llm/models n'a pas répondu, tenter /v1/models (llama-server direct)
            if (! is_array($modelsData) || $modelsData === []) {
                $v1Models = Http::timeout(self::HTTP_TIMEOUT)->get("{$normalizedUrl}/v1/models");
                if ($v1Models->successful()) {
                    $parsed = $v1Models->json();
                    $dataList = is_array($parsed['data'] ?? null) ? $parsed['data'] : [];
                    $modelsData = array_map(fn ($m) => [
                        'filename' => (string) ($m['id'] ?? 'model'),
                        'name' => (string) ($m['id'] ?? 'model'),
                        'size' => '',
                        'sizeBytes' => 0,
                        'from_v1' => true,
                    ], $dataList);
                    if ($activeModel === null && count($modelsData) > 0) {
                        $activeModel = $modelsData[0]['filename'];
                    }
                }
            }

            $models = [];
            if (is_array($modelsData)) {
                foreach ($modelsData as $item) {
                    if (! is_array($item)) {
                        continue;
                    }
                    $filename = (string) ($item['filename'] ?? $item['name'] ?? $item['id'] ?? '');
                    if ($filename === '') {
                        continue;
                    }
                    if (str_contains(strtolower($filename), 'mmproj')) {
                        continue; // Masquer les projecteurs de vision de la liste des modèles
                    }
                    // /api/llm/models renvoie des .gguf ; /v1/models peut exposer des ids sans extension (ex. qwen3).
                    $fromV1 = (bool) ($item['from_v1'] ?? false);
                    if (! $fromV1 && ! str_ends_with(strtolower($filename), '.gguf')) {
                        continue;
                    }
                    $models[] = [
                        'filename' => $filename,
                        'name' => (string) ($item['name'] ?? $filename),
                        'size' => (string) ($item['size'] ?? ''),
                        'size_bytes' => (int) ($item['sizeBytes'] ?? $item['size_bytes'] ?? 0),
                        'is_active' => $activeModel !== null && (strtolower($activeModel) === strtolower($filename) || str_contains(strtolower($activeModel), strtolower($filename))),
                    ];
                }
            }

            $gpu = null;
            if (is_array($telemetry) && isset($telemetry['gpu_name'])) {
                $gpu = [
                    'name' => (string) ($telemetry['gpu_name'] ?? 'GPU'),
                    'vram_used_gb' => (float) ($telemetry['vram_used_gb'] ?? 0),
                    'vram_total_gb' => (float) ($telemetry['vram_total_gb'] ?? 0),
                ];
            }

            $isRunning = ($backendInfo['running'] ?? false) || ($backendInfo['ready'] ?? false) || $activeModel !== null;

            return [
                'reachable' => true,
                'base_url' => $normalizedUrl,
                'active_model' => $activeModel,
                'running' => (bool) $isRunning,
                'context_size' => (int) ($settings['contextSize'] ?? $settings['context_size'] ?? 65536),
                'backend_mode' => (string) ($backendInfo['backendMode'] ?? $backendInfo['mode'] ?? 'CUDA GPU'),
                'gpu' => $gpu,
                'models' => $models,
                'error' => null,
            ];
        } catch (ConnectionException $e) {
            return [
                'reachable' => false,
                'base_url' => $normalizedUrl,
                'active_model' => null,
                'running' => false,
                'context_size' => null,
                'backend_mode' => null,
                'gpu' => null,
                'models' => [],
                'error' => "Impossible de joindre Pinokio sur {$normalizedUrl}: {$e->getMessage()}",
            ];
        } catch (Throwable $e) {
            return [
                'reachable' => false,
                'base_url' => $normalizedUrl,
                'active_model' => null,
                'running' => false,
                'context_size' => null,
                'backend_mode' => null,
                'gpu' => null,
                'models' => [],
                'error' => $e->getMessage(),
            ];
        }
    }

    /**
     * Charge un modèle dans la VRAM GPU de Pinokio avec les optimisations maximales RTX 3090.
     *
     * @param  array<string, mixed>  $options
     * @return array{ok: bool, message: string, data?: array<string, mixed>, error?: string}
     */
    public function startModel(string $baseUrl, string $modelName, array $options = []): array
    {
        $normalizedUrl = $this->normalizeBaseUrl($baseUrl);
        if ($normalizedUrl === null) {
            return ['ok' => false, 'message' => 'URL Pinokio invalide.'];
        }

        $payload = [
            'model' => basename($modelName),
            'contextSize' => (int) ($options['context_size'] ?? 65536),
            'gpuLayers' => (int) ($options['gpu_layers'] ?? -1),
            'flashAttn' => (bool) ($options['flash_attn'] ?? true),
            'cacheTypeK' => (string) ($options['cache_type_k'] ?? 'q8_0'),
            'cacheTypeV' => (string) ($options['cache_type_v'] ?? 'q8_0'),
            'batchSize' => (int) ($options['batch_size'] ?? 2048),
            'ubatchSize' => (int) ($options['ubatch_size'] ?? 512),
        ];

        try {
            $response = Http::timeout(30)->post("{$normalizedUrl}/api/llm/start", $payload);

            if ($response->successful()) {
                return [
                    'ok' => true,
                    'message' => "Modèle {$modelName} chargé avec succès en VRAM GPU !",
                    'data' => $response->json(),
                ];
            }

            $error = $response->json('error') ?? $response->body();

            return [
                'ok' => false,
                'message' => 'Échec du chargement du modèle.',
                'error' => is_string($error) ? $error : json_encode($error),
            ];
        } catch (Throwable $e) {
            return [
                'ok' => false,
                'message' => 'Erreur lors de la communication avec Pinokio.',
                'error' => $e->getMessage(),
            ];
        }
    }

    /**
     * Décharge le modèle actif de la VRAM pour libérer le GPU.
     *
     * @return array{ok: bool, message: string, error?: string}
     */
    public function stopModel(string $baseUrl): array
    {
        $normalizedUrl = $this->normalizeBaseUrl($baseUrl);
        if ($normalizedUrl === null) {
            return ['ok' => false, 'message' => 'URL Pinokio invalide.'];
        }

        try {
            $response = Http::timeout(15)->post("{$normalizedUrl}/api/llm/stop");

            if ($response->successful()) {
                return [
                    'ok' => true,
                    'message' => 'Modèle déchargé avec succès. VRAM GPU libérée.',
                ];
            }

            return [
                'ok' => false,
                'message' => 'Échec du déchargement du modèle.',
                'error' => $response->body(),
            ];
        } catch (Throwable $e) {
            return [
                'ok' => false,
                'message' => 'Erreur lors du déchargement.',
                'error' => $e->getMessage(),
            ];
        }
    }

    public function isReachable(string $baseUrl): bool
    {
        $normalized = $this->normalizeBaseUrl($baseUrl);
        if ($normalized === null) {
            return false;
        }

        try {
            $res = Http::timeout(3)->get("{$normalized}/v1/models");
            if ($res->successful()) {
                return true;
            }

            $healthRes = Http::timeout(3)->get("{$normalized}/api/health");

            return $healthRes->successful();
        } catch (Throwable) {
            return false;
        }
    }

    private function normalizeBaseUrl(string $url): ?string
    {
        $trimmed = trim($url);
        if ($trimmed === '') {
            return null;
        }

        if (! str_starts_with($trimmed, 'http://') && ! str_starts_with($trimmed, 'https://')) {
            $trimmed = 'http://'.$trimmed;
        }

        $parsed = parse_url($trimmed);
        if (! is_array($parsed) || empty($parsed['host'])) {
            return null;
        }

        $scheme = $parsed['scheme'] ?? 'http';
        $host = $parsed['host'];
        $port = isset($parsed['port']) ? ':'.$parsed['port'] : '';

        return "{$scheme}://{$host}{$port}";
    }
}
