<?php

namespace App\Services\DevForge\Agent;

use App\Enums\TaskModelTier;
use App\Models\AiAgent;
use App\Models\AiProviderConfig;
use App\Services\DevForge\Agent\Contracts\LlmProvider;
use App\Services\DevForge\Agent\Providers\AnthropicProvider;
use App\Services\DevForge\Agent\Providers\GeminiModelFailoverProvider;
use App\Services\DevForge\Agent\Providers\OllamaProvider;
use App\Services\DevForge\Agent\Providers\OpenAiCompatibleProvider;
use App\Services\DevForge\Agent\Providers\ResilientLlmProvider;

class LlmProviderFactory
{
    private ?\Closure $diagnosticSink = null;

    public function __construct(
        private readonly LlmModelCatalog $modelCatalog,
        private readonly TaskModelRouter $taskModelRouter,
        private readonly OllamaFallbackResolver $ollamaFallbackResolver,
        private readonly LlmProviderProbe $providerProbe,
    ) {}

    public function make(AiProviderConfig $config, ?TaskModelTier $tier = null, ?string $modelOverride = null): LlmProvider
    {
        return match ($config->provider) {
            'gemini' => new GeminiModelFailoverProvider(
                apiKey: (string) $config->api_key,
                model: $this->resolveGeminiModel($config, $modelOverride),
                baseUrl: LlmEndpointResolver::geminiBaseUrl($config->base_url),
                autoModels: LlmModelResolver::isAuto($modelOverride ?? $config->model)
                    ? $this->resolveAutoGeminiModels($config, $tier)
                    : null,
            ),
            'ollama' => new OllamaProvider(
                baseUrl: LlmEndpointResolver::ollamaBaseUrl($config->base_url),
                model: $this->resolveOllamaModel($config, $modelOverride),
            ),
            'openai', 'openrouter' => new OpenAiCompatibleProvider(
                apiKey: (string) $config->api_key,
                model: $this->resolveOpenAiCompatibleModel($config, $modelOverride),
                baseUrl: LlmEndpointResolver::openAiCompatibleBaseUrl($config->provider, $config->base_url),
                label: $config->provider,
                extraHeaders: $config->provider === 'openrouter'
                    ? [
                        'HTTP-Referer' => (string) config('app.url', 'https://github.com/bobdivx/devforge'),
                        'X-Title' => 'DevForge',
                    ]
                    : [],
            ),
            'anthropic' => new AnthropicProvider(
                apiKey: (string) $config->api_key,
                model: $this->resolveAnthropicModel($config, $modelOverride),
                baseUrl: LlmEndpointResolver::anthropicBaseUrl($config->base_url),
            ),
            default => throw new \InvalidArgumentException("Provider non supporté : {$config->provider}"),
        };
    }

    public function makeForAgent(
        AiAgent $agent,
        ?\Closure $onFallback = null,
        ?TaskModelTier $tier = null,
        ?\Closure $onDiagnostic = null,
    ): LlmProvider {
        $previousSink = $this->diagnosticSink;
        $this->diagnosticSink = $onDiagnostic;

        try {
            return $this->makeForAgentWithDiagnostics($agent, $onFallback, $tier);
        } finally {
            $this->diagnosticSink = $previousSink;
        }
    }

    private function makeForAgentWithDiagnostics(AiAgent $agent, ?\Closure $onFallback, ?TaskModelTier $tier): LlmProvider
    {
        $primaryConfig = $agent->effectiveProviderConfig();

        if (! $primaryConfig) {
            throw new \InvalidArgumentException('Aucun provider LLM configuré pour cet agent.');
        }

        $override = $agent->preferredLlmModel();
        $startWithFallback = false;

        if (
            config('devforge.agents_provider_probe', true)
            && $primaryConfig->provider === 'ollama'
        ) {
            $ollamaReport = $this->providerProbe->diagnose($primaryConfig);
            $this->emitDiagnostic($ollamaReport);
            if (! empty($ollamaReport) && ! ($ollamaReport['ok'] ?? true)) {
                $startWithFallback = true;
            }
        }

        $primary = $this->make($primaryConfig, $tier, $override);
        $fallbacks = $this->resolveFallbackProviders($agent, $primaryConfig, $tier);

        if ($fallbacks === []) {
            return $primary;
        }

        // Chaîne : primary → fallback1 → fallback2 (ex. Ollama → Gemini → OpenRouter).
        $wrapped = array_pop($fallbacks);
        $provider = $wrapped['provider'];
        $label = $wrapped['label'];

        while ($fallbacks !== []) {
            $previous = array_pop($fallbacks);
            $provider = new ResilientLlmProvider(
                primary: $previous['provider'],
                fallback: $provider,
                primaryLabel: $previous['label'],
                fallbackLabel: $label,
                onFallback: $onFallback,
            );
            $label = $previous['label'].' → '.$label;
        }

        return new ResilientLlmProvider(
            primary: $primary,
            fallback: $provider,
            primaryLabel: $this->label($primaryConfig, $override),
            fallbackLabel: $label,
            onFallback: $onFallback,
            startWithFallback: $startWithFallback,
        );
    }

    /**
     * Résout une chaîne de fallbacks sans health-check bloquant à l'init.
     * ResilientLlmProvider bascule au premier échec réel du primaire.
     *
     * @return array<int, array{provider: LlmProvider, label: string}>
     */
    private function resolveFallbackProviders(AiAgent $agent, AiProviderConfig $primaryConfig, ?TaskModelTier $tier): array
    {
        $fallbacks = [];
        $usedIds = [(int) $primaryConfig->id];

        if ($agent->fallback_provider_config_id) {
            $config = AiProviderConfig::query()
                ->where('team_id', $agent->team_id)
                ->whereKey($agent->fallback_provider_config_id)
                ->first();

            if ($config && ! in_array((int) $config->id, $usedIds, true)) {
                $fallbacks[] = [
                    'provider' => $this->make($config, $tier),
                    'label' => $this->label($config),
                ];
                $usedIds[] = (int) $config->id;
            }
        }

        if (! config('devforge.agents_auto_fallback', true)) {
            return $fallbacks;
        }

        // Si le primaire est Ollama (souvent instable / 502 NAS), basculer vers les clouds
        // déjà configurés (Gemini puis OpenRouter…) plutôt qu’un autre Ollama mort.
        // Pour Gemini Auto, remonter au moins en Standard : Flash-Lite est trop fragile en secours.
        if ($primaryConfig->provider === 'ollama') {
            $cloudTier = $tier === TaskModelTier::Light || $tier === null
                ? TaskModelTier::Standard
                : $tier;

            $cloudFallbacks = AiProviderConfig::query()
                ->where('team_id', $agent->team_id)
                ->where('provider', '!=', 'ollama')
                ->whereNotIn('id', $usedIds)
                ->orderByDesc('is_default')
                ->orderByRaw("CASE provider WHEN 'gemini' THEN 0 WHEN 'openrouter' THEN 1 WHEN 'openai' THEN 2 WHEN 'anthropic' THEN 3 ELSE 9 END")
                ->orderBy('id')
                ->limit(2)
                ->get();

            foreach ($cloudFallbacks as $cloudFallback) {
                $makeTier = $cloudFallback->provider === 'gemini' ? $cloudTier : $tier;
                $fallbacks[] = [
                    'provider' => $this->make($cloudFallback, $makeTier),
                    'label' => $this->label($cloudFallback).' (auto)',
                ];
                $usedIds[] = (int) $cloudFallback->id;
            }

            return $fallbacks;
        }

        // Le primaire est un cloud provider (Gemini, OpenAI, Anthropic, OpenRouter).
        // Ne pas fallback vers Ollama sauf si explicitement configuré comme fallback secondaire.
        // Les cloud providers sont stables — pas besoin d'un fallback local instable.
        
        return $fallbacks;
    }

    public function describeResolvedModel(AiProviderConfig $config, ?string $modelOverride = null): string
    {
        return match ($config->provider) {
            'ollama' => 'ollama/'.$this->resolveOllamaModel($config, $modelOverride),
            default => LlmModelResolver::displayProviderLabel($config),
        };
    }

    private function label(AiProviderConfig $config, ?string $modelOverride = null): string
    {
        if ($modelOverride !== null && ! LlmModelResolver::isAuto($modelOverride)) {
            $trimmed = trim($modelOverride);
            if ($trimmed !== '') {
                return $config->provider.'/'.$trimmed;
            }
        }

        return LlmModelResolver::displayProviderLabel($config);
    }

    /** @return array<int, string> */
    private function resolveAutoGeminiModels(AiProviderConfig $config, ?TaskModelTier $tier = null): array
    {
        $preferred = $tier !== null && config('devforge.agents_smart_routing', true)
            ? $this->taskModelRouter->prioritizeModelsForTier(
                $tier,
                LlmModelResolver::defaultAutoGeminiModels(),
            )
            : LlmModelResolver::defaultAutoGeminiModels();

        if (! config('devforge.agents_provider_probe', true)) {
            if ($tier !== null && config('devforge.agents_smart_routing', true)) {
                return $preferred;
            }

            return LlmModelResolver::prioritizeGeminiModels($this->availableGeminiModels($config));
        }

        $report = $this->providerProbe->diagnose($config, $preferred);
        $this->emitDiagnostic($report);

        $recommended = $report['recommended'];
        if ($recommended === []) {
            return $preferred;
        }

        // Garder l’ordre du tier, en tête les modèles qui ont passé le micro-chat.
        $working = array_values(array_filter(
            $recommended,
            fn (string $id): bool => in_array($id, array_column(
                array_filter($report['models_probed'], fn (array $row): bool => $row['ok']),
                'id',
            ), true),
        ));

        if ($working === []) {
            // Liste OK mais probes KO (RPM) : croiser preferred ∩ available.
            $available = $report['models_available'];
            $intersect = array_values(array_filter($preferred, fn (string $id): bool => in_array($id, $available, true)));

            return $intersect !== [] ? $intersect : $recommended;
        }

        $rest = array_values(array_filter($preferred, fn (string $id): bool => ! in_array($id, $working, true)));

        return array_values(array_unique([...$working, ...$rest, ...$recommended]));
    }

    /** @return array<int, string> */
    private function availableGeminiModels(AiProviderConfig $config): array
    {
        try {
            return collect($this->modelCatalog->listForProvider(
                'gemini',
                apiKey: (string) $config->api_key,
                baseUrl: LlmEndpointResolver::geminiBaseUrl($config->base_url),
            ))->pluck('id')->all();
        } catch (\Throwable) {
            return LlmModelResolver::defaultAutoGeminiModels();
        }
    }

    /**
     * @param  array{
     *     ok: bool,
     *     provider: string,
     *     models_available: array<int, string>,
     *     models_probed: array<int, array{id: string, ok: bool, error: string|null}>,
     *     recommended: array<int, string>,
     *     summary: string,
     *     lines: array<int, string>
     * }  $report
     */
    private function emitDiagnostic(array $report): void
    {
        if ($this->diagnosticSink instanceof \Closure) {
            ($this->diagnosticSink)($report);
        }
    }

    private function resolveGeminiModel(AiProviderConfig $config, ?string $modelOverride = null): string
    {
        $candidate = $modelOverride ?? $config->model;
        if (! LlmModelResolver::isAuto($candidate)) {
            $explicit = trim((string) $candidate);
            if ($explicit !== '') {
                return $explicit;
            }
        }

        return $config->resolvedModel();
    }

    private function resolveOllamaModel(AiProviderConfig $config, ?string $modelOverride = null): string
    {
        if ($modelOverride !== null && ! LlmModelResolver::isAuto($modelOverride)) {
            $override = trim($modelOverride);
            if ($override !== '') {
                return $override;
            }
        }

        if (! LlmModelResolver::isAuto($config->model)) {
            $explicit = trim($config->model);

            if ($explicit !== '' && LlmModelResolver::isToolCallingOllamaModel($explicit)) {
                return $explicit;
            }
        }

        try {
            $models = $this->modelCatalog->listForProvider(
                'ollama',
                baseUrl: LlmEndpointResolver::ollamaBaseUrl($config->base_url),
            );

            $picked = LlmModelResolver::pickBestOllamaModelForTools(
                collect($models)->pluck('id')->all(),
            );

            if ($picked !== null) {
                return $picked;
            }
        } catch (\Throwable) {
            // Fallback below.
        }

        return LlmModelResolver::defaultOllamaModel();
    }

    private function resolveOpenAiCompatibleModel(AiProviderConfig $config, ?string $modelOverride = null): string
    {
        $candidate = $modelOverride ?? $config->model;
        if (! LlmModelResolver::isAuto($candidate)) {
            $explicit = trim((string) $candidate);

            if ($explicit !== '') {
                return $explicit;
            }
        }

        return LlmProviderRegistry::defaultModel($config->provider);
    }

    private function resolveAnthropicModel(AiProviderConfig $config, ?string $modelOverride = null): string
    {
        $candidate = $modelOverride ?? $config->model;
        if (! LlmModelResolver::isAuto($candidate)) {
            $explicit = trim((string) $candidate);

            if ($explicit !== '') {
                return $explicit;
            }
        }

        return LlmProviderRegistry::defaultModel('anthropic');
    }
}
