<?php

namespace App\Services\DevForge\Agent;

use App\Models\AiProviderConfig;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;

/**
 * Vérifie un provider LLM : modèles listés + micro-chat sur les candidats.
 */
class LlmProviderProbe
{
    private const CACHE_TTL_SECONDS = 300;

    private const MAX_PROBE_MODELS = 4;

    public function __construct(
        private readonly LlmModelCatalog $modelCatalog,
    ) {}

    /**
     * @param  array<int, string>|null  $preferredModels
     * @return array{
     *     ok: bool,
     *     provider: string,
     *     models_available: array<int, string>,
     *     models_probed: array<int, array{id: string, ok: bool, error: string|null}>,
     *     recommended: array<int, string>,
     *     summary: string,
     *     lines: array<int, string>
     * }
     */
    public function diagnose(AiProviderConfig $config, ?array $preferredModels = null, bool $useCache = true): array
    {
        $cacheKey = $this->cacheKey($config, $preferredModels);

        if ($useCache) {
            $cached = Cache::get($cacheKey);
            if (is_array($cached) && isset($cached['ok'], $cached['summary'])) {
                return $cached;
            }
        }

        $report = match ($config->provider) {
            'gemini' => $this->diagnoseGemini($config, $preferredModels),
            'ollama' => $this->diagnoseOllama($config, $preferredModels),
            'openai', 'openrouter' => $this->diagnoseOpenAiCompatible($config, $preferredModels),
            'anthropic' => $this->diagnoseListOnly($config, $preferredModels),
            default => $this->failureReport((string) $config->provider, 'Provider non supporté pour le diagnostic.'),
        };

        Cache::put($cacheKey, $report, self::CACHE_TTL_SECONDS);

        return $report;
    }

    /**
     * @param  array<int, string>|null  $preferredModels
     * @return array<int, string>
     */
    public function recommendedModels(AiProviderConfig $config, ?array $preferredModels = null): array
    {
        $report = $this->diagnose($config, $preferredModels);

        if ($report['recommended'] !== []) {
            return $report['recommended'];
        }

        return array_values(array_unique(array_filter($preferredModels ?? [])));
    }

    /**
     * @param  array<int, string>|null  $preferredModels
     * @return array{
     *     ok: bool,
     *     provider: string,
     *     models_available: array<int, string>,
     *     models_probed: array<int, array{id: string, ok: bool, error: string|null}>,
     *     recommended: array<int, string>,
     *     summary: string,
     *     lines: array<int, string>
     * }
     */
    private function diagnoseGemini(AiProviderConfig $config, ?array $preferredModels): array
    {
        $lines = [];
        $apiKey = (string) $config->api_key;
        $baseUrl = LlmEndpointResolver::geminiBaseUrl($config->base_url);

        try {
            $available = collect($this->modelCatalog->listForProvider('gemini', apiKey: $apiKey, baseUrl: $baseUrl))
                ->pluck('id')
                ->map(fn ($id): string => (string) $id)
                ->values()
                ->all();
        } catch (\Throwable $exception) {
            return $this->failureReport('gemini', 'Liste des modèles Gemini impossible : '.$exception->getMessage());
        }

        $lines[] = 'Modèles chat Gemini listés : '.count($available).' ('.implode(', ', array_slice($available, 0, 8))
            .(count($available) > 8 ? '…' : '').').';

        $candidates = $this->candidates($preferredModels, $available, LlmModelResolver::defaultAutoGeminiModels());
        $recommended = LlmModelResolver::prioritizeGeminiModels($candidates !== [] ? $candidates : $available);

        return [
            'ok' => $available !== [],
            'provider' => 'gemini',
            'models_available' => $available,
            'models_probed' => [],
            'recommended' => array_values(array_unique($recommended)),
            'summary' => count($available).' modèle(s) Gemini disponible(s) (quota chat préservé).',
            'lines' => $lines,
        ];
    }

    /**
     * @param  array<int, string>|null  $preferredModels
     * @return array{
     *     ok: bool,
     *     provider: string,
     *     models_available: array<int, string>,
     *     models_probed: array<int, array{id: string, ok: bool, error: string|null}>,
     *     recommended: array<int, string>,
     *     summary: string,
     *     lines: array<int, string>
     * }
     */
    private function diagnoseOllama(AiProviderConfig $config, ?array $preferredModels): array
    {
        $baseUrl = LlmEndpointResolver::ollamaBaseUrl($config->base_url);
        $lines = [];

        try {
            $available = collect($this->modelCatalog->listForProvider('ollama', baseUrl: $baseUrl))
                ->pluck('id')
                ->map(fn ($id): string => (string) $id)
                ->values()
                ->all();
        } catch (\Throwable $exception) {
            return $this->failureReport('ollama', 'Ollama injoignable / modèles introuvables : '.$exception->getMessage());
        }

        $lines[] = 'Modèles Ollama (tools) listés : '.count($available).' ('.implode(', ', array_slice($available, 0, 8))
            .(count($available) > 8 ? '…' : '').').';

        $candidates = $this->candidates($preferredModels, $available, LlmModelResolver::AUTO_OLLAMA_PRIORITY);
        $probed = [];
        $working = [];

        foreach (array_slice($candidates, 0, 2) as $modelId) {
            $probe = $this->probeOllamaChat($baseUrl, $modelId);
            $probed[] = $probe;
            if ($probe['ok']) {
                $working[] = $modelId;
                $lines[] = "Probe OK : {$modelId}";
            } else {
                $lines[] = "Probe KO : {$modelId} — ".mb_substr((string) $probe['error'], 0, 180);
            }
        }

        if ($working === [] && $available !== []) {
            $working = $candidates !== [] ? $candidates : $available;
        }

        return [
            'ok' => $available !== [],
            'provider' => 'ollama',
            'models_available' => $available,
            'models_probed' => $probed,
            'recommended' => array_values(array_unique($working)),
            'summary' => count($available).' modèle(s) Ollama listé(s), '
                .count(array_filter($probed, fn (array $row): bool => $row['ok'])).' probe(s) OK.',
            'lines' => $lines,
        ];
    }

    /**
     * @param  array<int, string>|null  $preferredModels
     * @return array{
     *     ok: bool,
     *     provider: string,
     *     models_available: array<int, string>,
     *     models_probed: array<int, array{id: string, ok: bool, error: string|null}>,
     *     recommended: array<int, string>,
     *     summary: string,
     *     lines: array<int, string>
     * }
     */
    private function diagnoseOpenAiCompatible(AiProviderConfig $config, ?array $preferredModels): array
    {
        $provider = (string) $config->provider;
        $baseUrl = LlmEndpointResolver::openAiCompatibleBaseUrl($provider, $config->base_url);
        $apiKey = (string) $config->api_key;

        try {
            $available = collect($this->modelCatalog->listForProvider(
                $provider,
                apiKey: $apiKey,
                baseUrl: $baseUrl,
            ))->pluck('id')->map(fn ($id): string => (string) $id)->values()->all();
        } catch (\Throwable $exception) {
            $available = [];
        }

        $candidates = $this->candidates($preferredModels, $available, $available);
        $explicitModel = ! LlmModelResolver::isAuto($config->model) ? trim((string) $config->model) : null;
        if ($explicitModel !== null && ! in_array($explicitModel, $candidates, true)) {
            array_unshift($candidates, $explicitModel);
        }

        $probed = [];
        $working = [];

        // Si aucun modèle n'est listé automatiquement mais qu'un modèle est fourni ou préféré, on probe le chat.
        if ($available === [] && $candidates !== []) {
            foreach (array_slice($candidates, 0, 2) as $modelId) {
                $probe = $this->probeOpenAiChat($apiKey, $baseUrl, $modelId);
                $probed[] = $probe;
                if ($probe['ok']) {
                    $working[] = $modelId;
                }
            }
        }

        if ($working !== []) {
            $available = array_values(array_unique([...$available, ...$working]));
        }

        $recommended = $working !== [] ? $working : ($candidates !== [] ? $candidates : $available);
        $isOk = $available !== [] || $working !== [];

        $lines = [];
        if ($available !== []) {
            $lines[] = 'Modèles listés : '.implode(', ', array_slice($available, 0, 12)).(count($available) > 12 ? '…' : '');
        } else {
            $lines[] = "Aucun modèle listé automatiquement. Si vous utilisez Local AI Studio / LM Studio, assurez-vous d'utiliser l'URL '/v1' ou de spécifier un modèle manuellement.";
        }

        foreach ($probed as $row) {
            if ($row['ok']) {
                $lines[] = "Probe OK : {$row['id']}";
            } else {
                $lines[] = "Probe KO : {$row['id']} — ".mb_substr((string) $row['error'], 0, 180);
            }
        }

        $summary = count($available).' modèle(s) listé(s) pour '.$provider.'.';
        if ($working !== [] && count($available) === count($working)) {
            $summary = count($working).' modèle(s) vérifié(s) pour '.$provider.' ('.implode(', ', $working).').';
        }

        return [
            'ok' => $isOk,
            'provider' => $provider,
            'models_available' => $available,
            'models_probed' => $probed,
            'recommended' => array_values(array_unique($recommended)),
            'summary' => $summary,
            'lines' => $lines,
        ];
    }

    /**
     * @param  array<int, string>|null  $preferredModels
     * @return array{
     *     ok: bool,
     *     provider: string,
     *     models_available: array<int, string>,
     *     models_probed: array<int, array{id: string, ok: bool, error: string|null}>,
     *     recommended: array<int, string>,
     *     summary: string,
     *     lines: array<int, string>
     * }
     */
    private function diagnoseListOnly(AiProviderConfig $config, ?array $preferredModels): array
    {
        $provider = (string) $config->provider;

        try {
            $available = collect($this->modelCatalog->listForProvider(
                $provider,
                apiKey: (string) $config->api_key,
                baseUrl: LlmEndpointResolver::anthropicBaseUrl($config->base_url),
            ))->pluck('id')->map(fn ($id): string => (string) $id)->values()->all();
        } catch (\Throwable $exception) {
            return $this->failureReport($provider, 'Liste des modèles impossible : '.$exception->getMessage());
        }

        $candidates = $this->candidates($preferredModels, $available, $available);

        return [
            'ok' => $available !== [],
            'provider' => $provider,
            'models_available' => $available,
            'models_probed' => [],
            'recommended' => array_values(array_unique($candidates !== [] ? $candidates : $available)),
            'summary' => count($available).' modèle(s) listé(s) pour '.$provider.'.',
            'lines' => ['Modèles listés : '.implode(', ', array_slice($available, 0, 12))],
        ];
    }

    /**
     * @return array{id: string, ok: bool, error: string|null}
     */
    private function probeGeminiChat(string $apiKey, string $baseUrl, string $modelId): array
    {
        try {
            $response = Http::withHeaders([
                'Authorization' => 'Bearer '.$apiKey,
                'Accept' => 'application/json',
            ])
                ->connectTimeout(4)
                ->timeout(20)
                ->post(rtrim($baseUrl, '/').'/chat/completions', [
                    'model' => $modelId,
                    'messages' => [
                        ['role' => 'user', 'content' => 'Reply with OK'],
                    ],
                    'max_tokens' => 8,
                ]);
        } catch (ConnectionException $exception) {
            return ['id' => $modelId, 'ok' => false, 'error' => $exception->getMessage()];
        }

        if ($response->successful()) {
            return ['id' => $modelId, 'ok' => true, 'error' => null];
        }

        $body = (string) $response->body();

        return [
            'id' => $modelId,
            'ok' => false,
            'error' => "HTTP {$response->status()} ".mb_substr($body, 0, 220),
        ];
    }

    /**
     * @return array{id: string, ok: bool, error: string|null}
     */
    private function probeOllamaChat(string $baseUrl, string $modelId): array
    {
        try {
            $response = Http::connectTimeout(3)
                ->timeout(25)
                ->post(rtrim($baseUrl, '/').'/api/chat', [
                    'model' => $modelId,
                    'stream' => false,
                    'messages' => [
                        ['role' => 'user', 'content' => 'Reply with OK'],
                    ],
                ]);
        } catch (ConnectionException $exception) {
            return ['id' => $modelId, 'ok' => false, 'error' => $exception->getMessage()];
        }

        if ($response->successful()) {
            return ['id' => $modelId, 'ok' => true, 'error' => null];
        }

        return [
            'id' => $modelId,
            'ok' => false,
            'error' => "HTTP {$response->status()} ".mb_substr((string) $response->body(), 0, 220),
        ];
    }

    /**
     * @return array{id: string, ok: bool, error: string|null}
     */
    private function probeOpenAiChat(string $apiKey, string $baseUrl, string $modelId): array
    {
        $key = trim($apiKey);
        if ($key === '') {
            $key = 'sk-local-devforge';
        }

        $headers = [
            'Authorization' => 'Bearer '.$key,
            'Accept' => 'application/json',
            'Content-Type' => 'application/json',
        ];

        $clean = rtrim($baseUrl, '/');
        $chatUrls = str_ends_with($clean, '/v1')
            ? ["{$clean}/chat/completions", preg_replace('#/v1$#', '', $clean).'/chat/completions']
            : ["{$clean}/chat/completions", "{$clean}/v1/chat/completions"];

        $lastError = null;

        foreach (array_values(array_unique($chatUrls)) as $url) {
            try {
                $response = Http::withHeaders($headers)
                    ->connectTimeout(4)
                    ->timeout(20)
                    ->post($url, [
                        'model' => $modelId,
                        'messages' => [
                            ['role' => 'user', 'content' => 'Reply with OK'],
                        ],
                        'max_tokens' => 8,
                    ]);

                if ($response->successful()) {
                    return ['id' => $modelId, 'ok' => true, 'error' => null];
                }

                $lastError = "HTTP {$response->status()} ".mb_substr((string) $response->body(), 0, 220);
            } catch (ConnectionException $exception) {
                $lastError = $exception->getMessage();
            }
        }

        return ['id' => $modelId, 'ok' => false, 'error' => $lastError ?? 'Chat endpoint injoignable'];
    }

    /**
     * @param  array<int, string>|null  $preferred
     * @param  array<int, string>  $available
     * @param  array<int, string>  $defaults
     * @return array<int, string>
     */
    private function candidates(?array $preferred, array $available, array $defaults): array
    {
        $preferred = array_values(array_filter($preferred ?? []));
        $pool = $available !== [] ? $available : $defaults;
        $ordered = [];

        foreach ([...$preferred, ...$defaults, ...$pool] as $model) {
            if (! in_array($model, $pool, true) && $available !== []) {
                continue;
            }
            if (! in_array($model, $ordered, true)) {
                $ordered[] = $model;
            }
        }

        return $ordered;
    }

    /**
     * @return array{
     *     ok: bool,
     *     provider: string,
     *     models_available: array<int, string>,
     *     models_probed: array<int, array{id: string, ok: bool, error: string|null}>,
     *     recommended: array<int, string>,
     *     summary: string,
     *     lines: array<int, string>
     * }
     */
    private function failureReport(string $provider, string $summary): array
    {
        return [
            'ok' => false,
            'provider' => $provider,
            'models_available' => [],
            'models_probed' => [],
            'recommended' => [],
            'summary' => $summary,
            'lines' => [$summary],
        ];
    }

    /**
     * @param  array<int, string>|null  $preferredModels
     */
    private function cacheKey(AiProviderConfig $config, ?array $preferredModels): string
    {
        $pref = implode(',', $preferredModels ?? []);

        return 'llm-provider-probe:'.$config->id.':'.md5($config->provider.'|'.$config->model.'|'.$pref);
    }
}
