<?php

namespace App\Services\DevForge\Agent;

use App\Models\AiProviderConfig;
use App\Models\Team;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;
use Throwable;

/**
 * Contrôle à distance Uncensored Local Studio (serve.cjs) + inférence llama-server.
 *
 * Deux endpoints sur Demeter :
 * - Studio (port dynamique ~420xx) : /api/llm/start, /api/health, télémétrie
 * - LLM (port 10086) : /v1/chat/completions pour les agents DevForge
 */
class PinokioControlService
{
    public const DEFAULT_CONTEXT_SIZE = 49152;

    public const LLM_PORT = 10086;

    private const HTTP_TIMEOUT = 10;

    private const START_TIMEOUT = 300;

    private const STUDIO_PORT_MIN = 42000;

    private const STUDIO_PORT_MAX = 42120;

    private const DISCOVERY_TIMEOUT_SECONDS = 1;

    /**
     * @return list<array{
     *     id: int,
     *     name: string,
     *     base_url: string|null,
     *     studio_base_url: string|null,
     *     resolved_base_url: string|null,
     *     llm_base_url: string|null,
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
                $llmUrl = $this->normalizeLlmBaseUrl((string) ($provider->base_url ?? ''));
                $studioUrl = $this->normalizeBaseUrl((string) ($provider->studio_base_url ?? ''));

                return [
                    'id' => $provider->id,
                    'name' => $this->displayName($provider),
                    'base_url' => $provider->base_url,
                    'studio_base_url' => $provider->studio_base_url,
                    'resolved_base_url' => $studioUrl ?? $llmUrl,
                    'llm_base_url' => $llmUrl,
                    'is_default' => (bool) $provider->is_default,
                    'model' => $provider->model,
                    'reachable' => $this->isReachable((string) ($provider->base_url ?? ''), $provider->studio_base_url),
                ];
            })
            ->values()
            ->all();
    }

    public function looksLikePinokioProvider(AiProviderConfig $provider): bool
    {
        $url = strtolower((string) ($provider->base_url ?? ''));
        $studioUrl = strtolower((string) ($provider->studio_base_url ?? ''));
        $name = strtolower((string) $provider->name);

        if ($url !== '' && (
            str_contains($url, ':10086')
            || str_contains($url, ':420')
            || str_contains($url, '10.1.0.88')
        )) {
            return true;
        }

        if ($studioUrl !== '' && str_contains($studioUrl, ':420')) {
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
     *     studio_url: string|null,
     *     llm_url: string|null,
     *     active_model: string|null,
     *     running: bool,
     *     context_size: int|null,
     *     backend_mode: string|null,
     *     gpu: array{name: string, vram_used_gb: float, vram_total_gb: float}|null,
     *     models: list<array{filename: string, name: string, size: string, size_bytes: int, is_active: bool}>,
     *     error: string|null
     * }
     */
    public function status(string $baseUrl, ?string $studioUrl = null): array
    {
        $endpoints = $this->resolveEndpoints($baseUrl, $studioUrl);
        $controlUrl = $endpoints['control'];
        $llmUrl = $endpoints['llm'];

        if ($controlUrl === null && $llmUrl === null) {
            return $this->unreachableStatus($baseUrl, 'URL Pinokio invalide.');
        }

        try {
            $health = [];
            $telemetry = [];
            $modelsData = [];
            $llmStatus = [];
            $activeModel = null;
            $contextSize = null;
            $backendMode = 'CUDA GPU';
            $isRunning = false;

            if ($controlUrl !== null) {
                $healthRes = Http::timeout(self::HTTP_TIMEOUT)->get("{$controlUrl}/api/health");
                $telemetryRes = Http::timeout(self::HTTP_TIMEOUT)->get("{$controlUrl}/api/telemetry");
                $modelsRes = Http::timeout(self::HTTP_TIMEOUT)->get("{$controlUrl}/api/llm/models");
                $llmStatusRes = Http::timeout(self::HTTP_TIMEOUT)->get("{$controlUrl}/api/llm/status");

                $health = $healthRes->successful() ? (array) $healthRes->json() : [];
                $telemetry = $telemetryRes->successful() ? (array) $telemetryRes->json() : [];
                $modelsData = $modelsRes->successful() ? (array) $modelsRes->json() : [];
                $llmStatus = $llmStatusRes->successful() ? (array) $llmStatusRes->json() : [];

                $backendInfo = is_array($health['backend'] ?? null) ? $health['backend'] : [];
                $settings = is_array($backendInfo['settings'] ?? null)
                    ? $backendInfo['settings']
                    : (is_array($llmStatus['settings'] ?? null) ? $llmStatus['settings'] : []);

                $activeModel = is_string($settings['model'] ?? null) ? basename($settings['model']) : null;
                $contextSize = $this->intOrNull($settings['contextSize'] ?? $settings['context_size'] ?? null);
                $backendMode = (string) ($backendInfo['backendMode'] ?? $backendInfo['mode'] ?? $llmStatus['backendMode'] ?? 'CUDA GPU');
                $isRunning = (bool) (($backendInfo['running'] ?? false)
                    || ($backendInfo['ready'] ?? false)
                    || ($llmStatus['ready'] ?? false)
                    || ($llmStatus['running'] ?? false)
                    || $activeModel !== null);
            }

            if ($modelsData === [] && $llmUrl !== null) {
                $v1Models = Http::timeout(self::HTTP_TIMEOUT)->get("{$llmUrl}/v1/models");
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
                    $isRunning = true;
                }
            }

            $models = $this->parseModelList($modelsData, $activeModel);

            $gpu = null;
            if (is_array($telemetry) && isset($telemetry['gpu_name'])) {
                $gpu = [
                    'name' => (string) ($telemetry['gpu_name'] ?? 'GPU'),
                    'vram_used_gb' => (float) ($telemetry['vram_used_gb'] ?? 0),
                    'vram_total_gb' => (float) ($telemetry['vram_total_gb'] ?? 0),
                ];
            }

            $reachable = $controlUrl !== null
                ? ($health !== [] || $models !== [])
                : ($llmUrl !== null && $models !== []);

            if (! $reachable && $controlUrl === null) {
                return $this->unreachableStatus(
                    $baseUrl,
                    'Studio Pinokio introuvable sur le réseau local. Indiquez l’URL frontend (ex. http://10.1.0.88:42065).',
                    $llmUrl,
                );
            }

            return [
                'reachable' => $reachable || $isRunning,
                'base_url' => $controlUrl ?? $llmUrl,
                'studio_url' => $controlUrl,
                'llm_url' => $llmUrl,
                'active_model' => $activeModel,
                'running' => $isRunning,
                'context_size' => $contextSize ?? self::DEFAULT_CONTEXT_SIZE,
                'backend_mode' => $backendMode,
                'gpu' => $gpu,
                'models' => $models,
                'error' => null,
            ];
        } catch (ConnectionException $e) {
            return $this->unreachableStatus(
                $baseUrl,
                "Impossible de joindre Pinokio : {$e->getMessage()}",
                $llmUrl,
                $controlUrl,
            );
        } catch (Throwable $e) {
            return $this->unreachableStatus($baseUrl, $e->getMessage(), $llmUrl, $controlUrl);
        }
    }

    /**
     * @param  array<string, mixed>  $options
     * @return array{ok: bool, message: string, data?: array<string, mixed>, error?: string}
     */
    public function startModel(string $baseUrl, string $modelName, array $options = []): array
    {
        $studioUrl = isset($options['studio_url']) ? (string) $options['studio_url'] : null;
        $endpoints = $this->resolveEndpoints($baseUrl, $studioUrl);
        $controlUrl = $endpoints['control'];

        if ($controlUrl === null) {
            return [
                'ok' => false,
                'message' => 'URL studio Pinokio requise pour charger un modèle.',
                'error' => 'Indiquez studio_url (port frontend serve.cjs, ex. http://10.1.0.88:42065). Le port 10086 sert uniquement à l’inférence /v1.',
            ];
        }

        $payload = [
            'model' => basename($modelName),
            'contextSize' => (int) ($options['context_size'] ?? self::DEFAULT_CONTEXT_SIZE),
            'gpuLayers' => (int) ($options['gpu_layers'] ?? -1),
            'flashAttn' => (bool) ($options['flash_attn'] ?? true),
            'cacheTypeK' => (string) ($options['cache_type_k'] ?? 'q8_0'),
            'cacheTypeV' => (string) ($options['cache_type_v'] ?? 'q8_0'),
            'batchSize' => (int) ($options['batch_size'] ?? 512),
            'ubatchSize' => (int) ($options['ubatch_size'] ?? 512),
        ];

        try {
            $response = Http::timeout(self::START_TIMEOUT)->post("{$controlUrl}/api/llm/start", $payload);

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
     * @return array{ok: bool, message: string, error?: string}
     */
    public function stopModel(string $baseUrl, ?string $studioUrl = null): array
    {
        $endpoints = $this->resolveEndpoints($baseUrl, $studioUrl);
        $controlUrl = $endpoints['control'];

        if ($controlUrl === null) {
            return [
                'ok' => false,
                'message' => 'URL studio Pinokio requise pour décharger le modèle.',
                'error' => 'Indiquez studio_url (port frontend serve.cjs).',
            ];
        }

        try {
            $response = Http::timeout(15)->post("{$controlUrl}/api/llm/stop");

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

    public function isReachable(string $baseUrl, ?string $studioUrl = null): bool
    {
        $endpoints = $this->resolveEndpoints($baseUrl, $studioUrl);

        try {
            if ($endpoints['llm'] !== null) {
                $res = Http::timeout(3)->get("{$endpoints['llm']}/v1/models");
                if ($res->successful()) {
                    return true;
                }
            }

            if ($endpoints['control'] !== null) {
                $healthRes = Http::timeout(3)->get("{$endpoints['control']}/api/health");

                return $healthRes->successful();
            }
        } catch (Throwable) {
            return false;
        }

        return false;
    }

    /**
     * @return array{control: string|null, llm: string|null}
     */
    public function resolveEndpoints(string $baseUrl, ?string $studioUrl = null): array
    {
        $normalized = $this->normalizeBaseUrl($baseUrl);
        if ($normalized === null && ($studioUrl === null || trim($studioUrl) === '')) {
            return ['control' => null, 'llm' => null];
        }

        $host = parse_url($normalized ?? $this->normalizeBaseUrl($studioUrl ?? '') ?? '', PHP_URL_HOST);
        if (! is_string($host) || $host === '') {
            return ['control' => null, 'llm' => null];
        }

        $llmUrl = $this->normalizeLlmBaseUrl($normalized ?? "http://{$host}:".self::LLM_PORT);

        $controlUrl = null;
        if ($studioUrl !== null && trim($studioUrl) !== '') {
            $controlUrl = $this->normalizeBaseUrl($studioUrl);
        } elseif ($normalized !== null) {
            $port = parse_url($normalized, PHP_URL_PORT);
            $port = is_int($port) ? $port : null;

            if ($this->isStudioPort($port)) {
                $controlUrl = $normalized;
            } elseif ($this->isLlmPort($port)) {
                $controlUrl = $this->discoverStudioUrl($host);
            } else {
                $controlUrl = $normalized;
            }
        }

        return [
            'control' => $controlUrl,
            'llm' => $llmUrl,
        ];
    }

    public function normalizeLlmBaseUrl(string $url): ?string
    {
        $normalized = $this->normalizeBaseUrl($url);
        if ($normalized === null) {
            return null;
        }

        $host = parse_url($normalized, PHP_URL_HOST);
        if (! is_string($host) || $host === '') {
            return null;
        }

        $port = parse_url($normalized, PHP_URL_PORT);
        $port = is_int($port) ? $port : null;

        if ($this->isLlmPort($port)) {
            return $normalized;
        }

        if ($this->isStudioPort($port)) {
            $scheme = parse_url($normalized, PHP_URL_SCHEME) ?? 'http';

            return "{$scheme}://{$host}:".self::LLM_PORT;
        }

        return $normalized;
    }

    /**
     * URL OpenAI-compatible pour les agents (/v1/chat/completions).
     */
    public function normalizeLlmProviderUrl(string $url): ?string
    {
        $llm = $this->normalizeLlmBaseUrl($url);
        if ($llm === null) {
            return null;
        }

        return rtrim($llm, '/').'/v1';
    }

    private function discoverStudioUrl(string $host): ?string
    {
        for ($port = self::STUDIO_PORT_MIN; $port <= self::STUDIO_PORT_MAX; $port++) {
            try {
                $candidate = "http://{$host}:{$port}";
                $res = Http::timeout(self::DISCOVERY_TIMEOUT_SECONDS)->get("{$candidate}/api/health");
                if ($res->successful()) {
                    return $candidate;
                }
            } catch (Throwable) {
                continue;
            }
        }

        return null;
    }

    /**
     * @param  array<int|string, mixed>  $modelsData
     * @return list<array{filename: string, name: string, size: string, size_bytes: int, is_active: bool}>
     */
    private function parseModelList(array $modelsData, ?string $activeModel): array
    {
        $models = [];

        if (isset($modelsData['models']) && is_array($modelsData['models'])) {
            $modelsData = $modelsData['models'];
        }

        foreach ($modelsData as $item) {
            if (! is_array($item)) {
                continue;
            }

            $filename = (string) ($item['filename'] ?? $item['name'] ?? $item['id'] ?? '');
            if ($filename === '' || str_contains(strtolower($filename), 'mmproj')) {
                continue;
            }

            $fromV1 = (bool) ($item['from_v1'] ?? false);
            if (! $fromV1 && ! str_ends_with(strtolower($filename), '.gguf')) {
                continue;
            }

            $models[] = [
                'filename' => $filename,
                'name' => (string) ($item['name'] ?? $filename),
                'size' => (string) ($item['size'] ?? ''),
                'size_bytes' => (int) ($item['sizeBytes'] ?? $item['size_bytes'] ?? 0),
                'is_active' => $activeModel !== null && (
                    strtolower($activeModel) === strtolower($filename)
                    || str_contains(strtolower($activeModel), strtolower($filename))
                ),
            ];
        }

        return $models;
    }

    /**
     * @return array{
     *     reachable: bool,
     *     base_url: string|null,
     *     studio_url: string|null,
     *     llm_url: string|null,
     *     active_model: null,
     *     running: false,
     *     context_size: null,
     *     backend_mode: null,
     *     gpu: null,
     *     models: array{},
     *     error: string
     * }
     */
    private function unreachableStatus(
        string $baseUrl,
        string $error,
        ?string $llmUrl = null,
        ?string $controlUrl = null,
    ): array {
        return [
            'reachable' => false,
            'base_url' => $controlUrl ?? $llmUrl ?? $baseUrl,
            'studio_url' => $controlUrl,
            'llm_url' => $llmUrl,
            'active_model' => null,
            'running' => false,
            'context_size' => null,
            'backend_mode' => null,
            'gpu' => null,
            'models' => [],
            'error' => $error,
        ];
    }

    private function intOrNull(mixed $value): ?int
    {
        if (! is_numeric($value)) {
            return null;
        }

        $int = (int) $value;

        return $int > 0 ? $int : null;
    }

    private function isStudioPort(?int $port): bool
    {
        return $port !== null && $port >= self::STUDIO_PORT_MIN && $port <= self::STUDIO_PORT_MAX;
    }

    private function isLlmPort(?int $port): bool
    {
        return $port === self::LLM_PORT;
    }

    private function normalizeBaseUrl(string $url): ?string
    {
        $trimmed = trim($url);
        if ($trimmed === '') {
            return null;
        }

        $trimmed = rtrim($trimmed, '/');
        $trimmed = preg_replace('#/v1/?$#i', '', $trimmed) ?? $trimmed;

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
