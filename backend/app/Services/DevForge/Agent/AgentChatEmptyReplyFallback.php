<?php

namespace App\Services\DevForge\Agent;

use App\Enums\TaskModelTier;
use App\Models\AiAgent;
use App\Models\AiAgentRun;
use App\Services\DevForge\Agent\Contracts\LlmProvider;
use Illuminate\Support\Facades\Log;

/**
 * Orchestration du fallback quand un petit Ollama renvoie vide / unfavored.
 */
class AgentChatEmptyReplyFallback
{
    public function log(AiAgentRun $run, string $raw, string $reason = 'empty_or_absurd'): void
    {
        $preview = mb_substr(str_replace(["\n", "\r"], ' ', trim($raw)), 0, 80);

        $run->appendLog(
            'Réponse LLM vide/absurde ignorée (ne pas afficher à l’utilisateur)'
            .' preview='.json_encode($preview, JSON_UNESCAPED_UNICODE)
            ." reason={$reason}."
        );

        Log::warning('agent.chat.empty_or_absurd_reply', [
            'run_id' => $run->id ?? null,
            'preview' => $preview,
            'reason' => $reason,
        ]);
    }

    public static function isTinyOllamaModel(?string $model): bool
    {
        return LlmModelSize::isTooSmallForTools($model);
    }

    /**
     * @param  array<int, string>  $available
     */
    public function strongerOllamaModel(?string $currentModel, array $available = []): ?string
    {
        if ($available === []) {
            return null;
        }

        $current = mb_strtolower(trim((string) $currentModel));
        $candidates = LlmModelResolver::prioritizeOllamaModelsForTools($available);

        foreach ($candidates as $model) {
            if (self::isTinyOllamaModel($model)) {
                continue;
            }
            if ($current !== '' && mb_strtolower($model) === $current) {
                continue;
            }

            return $model;
        }

        return null;
    }

    /**
     * @return array{base_url: string, model: string}|null
     */
    public function discoveredOllama(): ?array
    {
        try {
            return app(OllamaFallbackResolver::class)->discover();
        } catch (\Throwable) {
            return null;
        }
    }

    /**
     * Payload LLM sidecar plus grand (Ollama / Demeter) pour un retry Rig.
     *
     * @param  array<string, mixed>  $llm
     * @return array<string, mixed>|null
     */
    public function strongerLlmPayload(array $llm): ?array
    {
        $provider = mb_strtolower((string) ($llm['provider'] ?? ''));
        $current = (string) ($llm['model'] ?? '');

        if ($provider !== 'ollama' && ! self::isTinyOllamaModel($current)) {
            return null;
        }

        $discovered = $this->discoveredOllama();
        $available = [];
        $baseUrl = $llm['base_url'] ?? null;
        if (is_array($discovered)) {
            $baseUrl = $discovered['base_url'] ?? $baseUrl;
            if (isset($discovered['model']) && is_string($discovered['model']) && $discovered['model'] !== '') {
                $available[] = $discovered['model'];
            }
        }

        $stronger = $this->strongerOllamaModel($current, $available);
        if ($stronger === null) {
            return null;
        }

        $next = $llm;
        $next['provider'] = 'ollama';
        $next['model'] = $stronger;
        if (is_string($baseUrl) && $baseUrl !== '') {
            $next['base_url'] = $baseUrl;
        }

        return $next;
    }

    public function retryPhpProvider(AiAgent $agent, ?TaskModelTier $tier = null): ?LlmProvider
    {
        $config = $agent->effectiveProviderConfig();
        if ($config === null || $config->provider !== 'ollama') {
            return null;
        }

        $discovered = $this->discoveredOllama();
        $available = [];
        if (is_array($discovered) && isset($discovered['model']) && is_string($discovered['model'])) {
            $available[] = $discovered['model'];
        }

        $stronger = $this->strongerOllamaModel($config->model, $available);
        if ($stronger === null) {
            return null;
        }

        return app(LlmProviderFactory::class)->make($config, $tier ?? TaskModelTier::Heavy, $stronger);
    }
}
