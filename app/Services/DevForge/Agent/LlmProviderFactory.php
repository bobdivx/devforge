<?php

namespace App\Services\DevForge\Agent;

use App\Enums\TaskModelTier;
use App\Models\AiAgent;
use App\Models\AiProviderConfig;
use App\Services\DevForge\Agent\Contracts\LlmProvider;
use App\Services\DevForge\Agent\Providers\GeminiModelFailoverProvider;
use App\Services\DevForge\Agent\Providers\OllamaProvider;
use App\Services\DevForge\Agent\Providers\ResilientLlmProvider;

class LlmProviderFactory
{
    public function __construct(
        private readonly LlmModelCatalog $modelCatalog,
        private readonly TaskModelRouter $taskModelRouter,
        private readonly OllamaFallbackResolver $ollamaFallbackResolver,
    ) {}

    public function make(AiProviderConfig $config, ?TaskModelTier $tier = null): LlmProvider
    {
        return match ($config->provider) {
            'gemini' => new GeminiModelFailoverProvider(
                apiKey: (string) $config->api_key,
                model: $config->resolvedModel(),
                baseUrl: LlmEndpointResolver::geminiBaseUrl($config->base_url),
                autoModels: LlmModelResolver::isAuto($config->model)
                    ? $this->resolveAutoGeminiModels($config, $tier)
                    : null,
            ),
            'ollama' => new OllamaProvider(
                baseUrl: LlmEndpointResolver::ollamaBaseUrl($config->base_url),
                model: $this->resolveOllamaModel($config),
            ),
            default => throw new \InvalidArgumentException("Provider non supporté : {$config->provider}"),
        };
    }

    public function makeForAgent(AiAgent $agent, ?\Closure $onFallback = null, ?TaskModelTier $tier = null): LlmProvider
    {
        $primaryConfig = $agent->effectiveProviderConfig();

        if (! $primaryConfig) {
            throw new \InvalidArgumentException('Aucun provider LLM configuré pour cet agent.');
        }

        $primary = $this->make($primaryConfig, $tier);
        $fallback = $this->resolveFallbackProvider($agent, $primaryConfig, $tier);

        if ($fallback === null) {
            return $primary;
        }

        return new ResilientLlmProvider(
            primary: $primary,
            fallback: $fallback['provider'],
            primaryLabel: $this->label($primaryConfig),
            fallbackLabel: $fallback['label'],
            onFallback: $onFallback,
        );
    }

    /**
     * Résout un fallback sans health-check bloquant à l'init.
     * ResilientLlmProvider bascule au premier échec réel du primaire.
     *
     * @return array{provider: LlmProvider, label: string}|null
     */
    private function resolveFallbackProvider(AiAgent $agent, AiProviderConfig $primaryConfig, ?TaskModelTier $tier): ?array
    {
        if ($agent->fallback_provider_config_id) {
            $config = AiProviderConfig::query()
                ->where('team_id', $agent->team_id)
                ->whereKey($agent->fallback_provider_config_id)
                ->first();

            if ($config && $config->id !== $primaryConfig->id) {
                return [
                    'provider' => $this->make($config, $tier),
                    'label' => $this->label($config),
                ];
            }
        }

        if (! config('devforge.agents_auto_fallback', true)) {
            return null;
        }

        // Préférer la découverte réseau (DEVFORGE_OLLAMA_URL) — rapide et fiable depuis Docker.
        $discovered = $this->ollamaFallbackResolver->discover();

        if ($discovered !== null) {
            return [
                'provider' => new OllamaProvider($discovered['base_url'], $discovered['model']),
                'label' => 'ollama/'.$discovered['model'].' (auto)',
            ];
        }

        $dbFallback = AiProviderConfig::query()
            ->where('team_id', $agent->team_id)
            ->where('provider', 'ollama')
            ->whereKeyNot($agent->provider_config_id)
            ->orderByDesc('is_default')
            ->orderBy('id')
            ->first();

        if ($dbFallback) {
            return [
                'provider' => $this->make($dbFallback, $tier),
                'label' => $this->label($dbFallback),
            ];
        }

        return null;
    }

    public function describeResolvedModel(AiProviderConfig $config): string
    {
        return match ($config->provider) {
            'ollama' => 'ollama/'.$this->resolveOllamaModel($config),
            default => LlmModelResolver::displayProviderLabel($config),
        };
    }

    private function label(AiProviderConfig $config): string
    {
        return LlmModelResolver::displayProviderLabel($config);
    }

    /** @return array<int, string> */
    private function resolveAutoGeminiModels(AiProviderConfig $config, ?TaskModelTier $tier = null): array
    {
        // Pour les runs agents (tier fourni), éviter un listModels Gemini synchrone
        // qui peut bloquer l'init plusieurs dizaines de secondes depuis le NAS.
        if ($tier !== null && config('devforge.agents_smart_routing', true)) {
            return $this->taskModelRouter->prioritizeModelsForTier(
                $tier,
                LlmModelResolver::defaultAutoGeminiModels(),
            );
        }

        $available = $this->availableGeminiModels($config);

        return LlmModelResolver::prioritizeGeminiModels($available);
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

    private function resolveOllamaModel(AiProviderConfig $config): string
    {
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
}
