<?php

namespace App\Services\DevForge\Agent;

use App\Models\AiAgent;
use App\Models\AiProviderConfig;
use App\Services\DevForge\Agent\Contracts\LlmProvider;
use App\Services\DevForge\Agent\LlmEndpointResolver;
use App\Services\DevForge\Agent\Providers\GeminiModelFailoverProvider;
use App\Services\DevForge\Agent\Providers\GeminiProvider;
use App\Services\DevForge\Agent\Providers\OllamaProvider;
use App\Services\DevForge\Agent\Providers\ResilientLlmProvider;

class LlmProviderFactory
{
    public function make(AiProviderConfig $config): LlmProvider
    {
        return match ($config->provider) {
            'gemini' => new GeminiModelFailoverProvider(
                apiKey: (string) $config->api_key,
                model: $config->model,
                baseUrl: LlmEndpointResolver::geminiBaseUrl($config->base_url),
            ),
            'ollama' => new OllamaProvider(
                baseUrl: LlmEndpointResolver::ollamaBaseUrl($config->base_url),
                model: $config->model,
            ),
            default => throw new \InvalidArgumentException("Provider non supporté : {$config->provider}"),
        };
    }

    public function makeForAgent(AiAgent $agent, ?\Closure $onFallback = null): LlmProvider
    {
        $primaryConfig = $agent->providerConfig;

        if (! $primaryConfig) {
            throw new \InvalidArgumentException('Aucun provider LLM configuré pour cet agent.');
        }

        $primary = $this->make($primaryConfig);
        $fallbackConfig = $this->resolveFallbackConfig($agent);

        if (! $fallbackConfig || $fallbackConfig->id === $primaryConfig->id) {
            return $primary;
        }

        return new ResilientLlmProvider(
            primary: $primary,
            fallback: $this->make($fallbackConfig),
            primaryLabel: $this->label($primaryConfig),
            fallbackLabel: $this->label($fallbackConfig),
            onFallback: $onFallback,
        );
    }

    private function resolveFallbackConfig(AiAgent $agent): ?AiProviderConfig
    {
        if ($agent->fallback_provider_config_id) {
            return AiProviderConfig::query()
                ->where('team_id', $agent->team_id)
                ->whereKey($agent->fallback_provider_config_id)
                ->first();
        }

        if (! config('devforge.agents_auto_fallback', true)) {
            return null;
        }

        return AiProviderConfig::query()
            ->where('team_id', $agent->team_id)
            ->where('provider', 'ollama')
            ->whereKeyNot($agent->provider_config_id)
            ->orderByDesc('is_default')
            ->orderBy('id')
            ->get()
            ->first(function (AiProviderConfig $config): bool {
                try {
                    return $this->make($config)->testConnection();
                } catch (\Throwable) {
                    return false;
                }
            });
    }

    private function label(AiProviderConfig $config): string
    {
        return "{$config->provider}/{$config->model}";
    }
}
