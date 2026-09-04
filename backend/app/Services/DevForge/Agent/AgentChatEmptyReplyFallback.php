<?php

namespace App\Services\DevForge\Agent;

use App\Enums\TaskModelTier;
use App\Models\AiAgent;
use App\Models\AiAgentRun;
use App\Models\AiProviderConfig;
use App\Services\DevForge\Agent\Contracts\LlmProvider;
use Illuminate\Support\Facades\Log;

/**
 * Orchestration du fallback quand un LLM renvoie vide / unfavored / empty completion.
 * Ordre : modèle Ollama plus fort (même provider) → agent.fallback_provider → autres providers équipe.
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

    public static function isEmptyCompletionFailure(string $message): bool
    {
        return AgentEmptyAbsurdReply::isEmptyCompletionFailure($message);
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
     * Payload LLM sidecar plus grand (Ollama / Demeter) pour un retry Rig (même provider).
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

    /**
     * Clé stable pour dédupliquer les tentatives Rig (provider+model+base_url).
     *
     * @param  array<string, mixed>  $llm
     */
    public function payloadAttemptKey(array $llm): string
    {
        return mb_strtolower(trim((string) ($llm['provider'] ?? '')))
            .'|'.mb_strtolower(trim((string) ($llm['model'] ?? '')))
            .'|'.mb_strtolower(rtrim(trim((string) ($llm['base_url'] ?? '')), '/'));
    }

    /**
     * Ordre de failover cross-provider pour Rig / empty completion :
     * 1) modèle Ollama plus fort (si primaire Ollama)
     * 2) agent.fallback_provider_config_id
     * 3) autres providers équipe avec modèle concret (pas Auto)
     *
     * @param  array<string, mixed>  $currentLlm
     * @param  array<int, string>  $attemptedKeys
     * @return array<string, mixed>|null
     */
    public function nextCrossProviderLlmPayload(AiAgent $agent, array $currentLlm, array &$attemptedKeys = []): ?array
    {
        $currentKey = $this->payloadAttemptKey($currentLlm);
        if ($currentKey !== '||' && ! in_array($currentKey, $attemptedKeys, true)) {
            $attemptedKeys[] = $currentKey;
        }

        $stronger = $this->strongerLlmPayload($currentLlm);
        if (is_array($stronger)) {
            $key = $this->payloadAttemptKey($stronger);
            if (! in_array($key, $attemptedKeys, true)) {
                $attemptedKeys[] = $key;

                return $stronger;
            }
        }

        $rig = app(RigAgentClient::class);
        foreach ($this->orderedFallbackConfigs($agent, $currentLlm) as $config) {
            $payload = $rig->llmFromProviderSettings(config: $config, agent: $agent, teamId: $agent->team_id);
            if (! is_array($payload)) {
                continue;
            }

            $model = trim((string) ($payload['model'] ?? ''));
            if ($model === '' || LlmModelResolver::isAuto($model)) {
                continue;
            }

            $key = $this->payloadAttemptKey($payload);
            if (in_array($key, $attemptedKeys, true)) {
                continue;
            }

            $attemptedKeys[] = $key;

            return $payload;
        }

        return null;
    }

    /**
     * @param  array<string, mixed>  $currentLlm
     * @return list<AiProviderConfig>
     */
    public function orderedFallbackConfigs(AiAgent $agent, array $currentLlm = []): array
    {
        $primaryId = (int) ($agent->provider_config_id ?? 0);
        $usedIds = $primaryId > 0 ? [$primaryId] : [];
        $ordered = [];

        if ($agent->fallback_provider_config_id) {
            $fallback = AiProviderConfig::query()
                ->where('team_id', $agent->team_id)
                ->whereKey($agent->fallback_provider_config_id)
                ->first();

            if ($fallback instanceof AiProviderConfig && ! in_array((int) $fallback->id, $usedIds, true)) {
                $ordered[] = $fallback;
                $usedIds[] = (int) $fallback->id;
            }
        }

        if (! config('devforge.agents_auto_fallback', true)) {
            return $ordered;
        }

        $failingProvider = mb_strtolower((string) ($currentLlm['provider'] ?? $agent->effectiveProviderConfig()?->provider ?? ''));

        // Après un échec Gemini cloud, préférer Ollama / OpenAI custom avant un autre Gemini.
        $prioritySql = match ($failingProvider) {
            'gemini' => "CASE provider WHEN 'ollama' THEN 0 WHEN 'openai' THEN 1 WHEN 'openrouter' THEN 2 WHEN 'anthropic' THEN 3 WHEN 'gemini' THEN 4 ELSE 9 END",
            'ollama' => "CASE provider WHEN 'gemini' THEN 0 WHEN 'openrouter' THEN 1 WHEN 'openai' THEN 2 WHEN 'anthropic' THEN 3 WHEN 'ollama' THEN 4 ELSE 9 END",
            default => "CASE provider WHEN 'ollama' THEN 0 WHEN 'openrouter' THEN 1 WHEN 'openai' THEN 2 WHEN 'anthropic' THEN 3 WHEN 'gemini' THEN 4 ELSE 9 END",
        };

        $others = AiProviderConfig::query()
            ->where('team_id', $agent->team_id)
            ->whereNotIn('id', $usedIds !== [] ? $usedIds : [0])
            ->orderByDesc('is_default')
            ->orderByRaw($prioritySql)
            ->orderBy('id')
            ->limit(4)
            ->get();

        foreach ($others as $other) {
            if (! $other instanceof AiProviderConfig) {
                continue;
            }
            if (in_array((int) $other->id, $usedIds, true)) {
                continue;
            }
            $ordered[] = $other;
            $usedIds[] = (int) $other->id;
        }

        return $ordered;
    }

    public function retryPhpProvider(AiAgent $agent, ?TaskModelTier $tier = null): ?LlmProvider
    {
        $config = $agent->effectiveProviderConfig();
        if ($config === null) {
            return null;
        }

        // 1) Même provider Ollama avec modèle plus fort
        if ($config->provider === 'ollama') {
            $discovered = $this->discoveredOllama();
            $available = [];
            if (is_array($discovered) && isset($discovered['model']) && is_string($discovered['model'])) {
                $available[] = $discovered['model'];
            }

            $stronger = $this->strongerOllamaModel($config->model, $available);
            if ($stronger !== null) {
                return app(LlmProviderFactory::class)->make($config, $tier ?? TaskModelTier::Heavy, $stronger);
            }
        }

        // 2) Cross-provider : fallback agent puis autres configs équipe
        foreach ($this->orderedFallbackConfigs($agent, [
            'provider' => (string) $config->provider,
            'model' => (string) $config->model,
        ]) as $fallbackConfig) {
            $model = $fallbackConfig->resolvedModel();
            if (LlmModelResolver::isAuto($model)) {
                $model = null;
            }

            try {
                return app(LlmProviderFactory::class)->make(
                    $fallbackConfig,
                    $tier ?? TaskModelTier::Heavy,
                    is_string($model) && $model !== '' ? $model : null,
                );
            } catch (\Throwable) {
                continue;
            }
        }

        return null;
    }
}
