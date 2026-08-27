<?php

namespace App\Services\DevForge\Agent;

use App\Models\AiAgent;
use App\Models\AiAgentSession;
use App\Models\AiProviderConfig;
use App\Models\Team;
use App\Models\User;
use Illuminate\Support\Facades\Http;
use Laravel\Sanctum\PersonalAccessToken;

/**
 * Client HTTP mince vers le sidecar Rig (devforge-agent).
 * AGENT_URL vide = no-op (chemin PHP historique).
 */
class RigAgentClient
{
    public const DEFAULT_MCP_URL = 'http://api:8080/mcp/devforge';

    public function enabled(): bool
    {
        return filled(config('devforge.agent_url'));
    }

    /**
     * @return array<string, mixed>
     */
    public function health(): array
    {
        $response = Http::timeout(5)->get($this->baseUrl().'/health');

        $json = $response->json();

        return is_array($json) ? $json : [];
    }

    /**
     * @param  array{provider?: string|null, base_url?: string|null, api_key?: string|null, model?: string|null}  $llm
     * @param  array{mcp_url?: string|null, mcp_token?: string|null, messages?: list<array<string, mixed>>}  $extra
     */
    public function chat(string $prompt, ?string $preamble = null, ?string $model = null, array $llm = [], array $extra = []): string
    {
        $payload = ['prompt' => $prompt];

        if ($preamble !== null) {
            $payload['preamble'] = $preamble;
        }

        $resolvedModel = $this->nonEmptyString($llm['model'] ?? null) ?? $this->nonEmptyString($model);
        if ($resolvedModel !== null) {
            $payload['model'] = $resolvedModel;
        }

        foreach (['provider', 'base_url', 'api_key'] as $key) {
            $value = $this->nonEmptyString($llm[$key] ?? null);
            if ($value !== null) {
                $payload[$key] = $value;
            }
        }

        foreach (['mcp_url', 'mcp_token'] as $key) {
            $value = $this->nonEmptyString($extra[$key] ?? null);
            if ($value !== null) {
                $payload[$key] = $value;
            }
        }

        if (isset($extra['messages']) && is_array($extra['messages']) && $extra['messages'] !== []) {
            $payload['messages'] = $extra['messages'];
        }

        $response = Http::timeout(180)->post($this->baseUrl().'/v1/chat', $payload);

        if ($response->failed()) {
            throw new \RuntimeException(
                'Rig agent chat '.$response->status().': '.mb_substr($response->body(), 0, 300),
            );
        }

        $text = $response->json('text');

        if (! is_string($text)) {
            throw new \RuntimeException('Rig agent chat: missing text in response.');
        }

        return $text;
    }

    /**
     * Résout le payload LLM sidecar depuis les providers UX (AiProviderConfig).
     *
     * @return array{provider: string, base_url: string|null, api_key: string|null, model: string|null}|null
     */
    public function llmFromProviderSettings(?AiProviderConfig $config = null, ?AiAgent $agent = null, ?int $teamId = null): ?array
    {
        $config ??= $agent?->effectiveProviderConfig();

        if ($config === null && $teamId !== null) {
            $config = AiProviderConfig::query()
                ->where('team_id', $teamId)
                ->orderByDesc('is_default')
                ->orderBy('id')
                ->first();
        }

        if (! $config instanceof AiProviderConfig) {
            return null;
        }

        $model = $agent?->preferredLlmModel();
        if ($model === null || LlmModelResolver::isAuto($model)) {
            $stored = $config->resolvedModel();
            $model = LlmModelResolver::isAuto($stored)
                ? LlmProviderRegistry::defaultModel($config->provider)
                : $stored;
        }

        if (LlmModelResolver::isAuto($model)) {
            $model = null;
        }

        return [
            'provider' => (string) $config->provider,
            'base_url' => $this->resolveBaseUrl($config),
            'api_key' => $this->nonEmptyString($config->api_key),
            'model' => $this->nonEmptyString($model),
        ];
    }

    /**
     * Mint un token Sanctum (abilities read+write) lié à l'équipe de l'agent.
     *
     * @return array{url: string, token: string|null, id: int|null}
     */
    public function issueMcpCredentials(AiAgent $agent, ?AiAgentSession $session = null): array
    {
        $url = $this->mcpUrl();
        $agent->loadMissing(['team']);
        $team = $agent->team;

        if (! $team instanceof Team) {
            return ['url' => $url, 'token' => null, 'id' => null];
        }

        $user = $this->tokenUser($team);
        if (! $user instanceof User) {
            return ['url' => $url, 'token' => null, 'id' => null];
        }

        $previousTeam = session('currentTeam');
        session(['currentTeam' => $team]);

        try {
            $issued = $user->createToken('mcp-write', ['read', 'write']);
            $id = $issued->accessToken->id ?? null;

            return [
                'url' => $url,
                'token' => $issued->plainTextToken,
                'id' => is_numeric($id) ? (int) $id : null,
            ];
        } finally {
            if ($previousTeam === null) {
                session()->forget('currentTeam');
            } else {
                session(['currentTeam' => $previousTeam]);
            }
        }
    }

    public function revokeMcpCredentials(int|string|null $id): void
    {
        if ($id === null || $id === '') {
            return;
        }

        PersonalAccessToken::query()->whereKey($id)->delete();
    }

    public function mcpUrl(): string
    {
        $configured = $this->nonEmptyString(env('AGENT_MCP_URL'));

        return $configured ?? self::DEFAULT_MCP_URL;
    }

    private function tokenUser(Team $team): ?User
    {
        $user = $team->members()
            ->orderByRaw("CASE WHEN team_user.role = 'owner' THEN 0 WHEN team_user.role = 'admin' THEN 1 ELSE 2 END")
            ->orderBy('users.id')
            ->first();

        return $user instanceof User ? $user : null;
    }

    private function resolveBaseUrl(AiProviderConfig $config): ?string
    {
        try {
            return match ($config->provider) {
                'ollama' => LlmEndpointResolver::ollamaBaseUrl($config->base_url),
                'gemini' => LlmEndpointResolver::geminiBaseUrl($config->base_url),
                'openai', 'openrouter' => LlmEndpointResolver::openAiCompatibleBaseUrl($config->provider, $config->base_url),
                'anthropic' => LlmEndpointResolver::anthropicBaseUrl($config->base_url),
                default => $this->nonEmptyString($config->base_url),
            };
        } catch (\InvalidArgumentException) {
            return $this->nonEmptyString($config->base_url);
        }
    }

    private function nonEmptyString(mixed $value): ?string
    {
        if (! is_string($value)) {
            return null;
        }

        $trimmed = trim($value);

        return $trimmed === '' ? null : $trimmed;
    }

    private function baseUrl(): string
    {
        return rtrim((string) config('devforge.agent_url'), '/');
    }
}
