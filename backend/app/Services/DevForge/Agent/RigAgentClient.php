<?php

namespace App\Services\DevForge\Agent;

use App\Models\AiAgent;
use App\Models\AiAgentSession;
use App\Models\AiProviderConfig;
use App\Models\PersonalAccessToken;
use App\Models\User;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;

/**
 * Client HTTP vers le sidecar Rig (devforge-agent).
 * AGENT_URL vide = no-op (boucle PHP inchangée).
 */
class RigAgentClient
{
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
     * @param  array{messages?: list<array{role: string, content: string}>, mcp_url?: string|null, mcp_token?: string|null}  $runtime
     */
    public function chat(string $prompt, ?string $preamble = null, ?string $model = null, array $llm = [], array $runtime = []): string
    {
        $payload = ['prompt' => $prompt];

        if ($preamble !== null) {
            $payload['preamble'] = $preamble;
        }

        $resolvedModel = $this->nonEmptyString($llm['model'] ?? null) ?? $this->nonEmptyString($model);
        if ($resolvedModel === null) {
            throw new \RuntimeException(
                'Aucun modèle LLM configuré. Choisis-en un (pas Auto) dans Connexions ou sur la fiche de l\'agent.',
            );
        }
        $payload['model'] = $resolvedModel;

        foreach (['provider', 'base_url', 'api_key'] as $key) {
            $value = $this->nonEmptyString($llm[$key] ?? null);
            if ($value !== null) {
                $payload[$key] = $value;
            }
        }

        $messages = $runtime['messages'] ?? null;
        if (is_array($messages) && $messages !== []) {
            $payload['messages'] = array_values(array_map(function (mixed $message): array {
                $row = is_array($message) ? $message : [];

                return [
                    'role' => (string) ($row['role'] ?? 'user'),
                    'content' => (string) ($row['content'] ?? ''),
                ];
            }, $messages));
        }

        foreach (['mcp_url', 'mcp_token'] as $key) {
            $value = $this->nonEmptyString($runtime[$key] ?? null);
            if ($value !== null) {
                $payload[$key] = $value;
            }
        }

        $response = Http::timeout(120)->post($this->baseUrl().'/v1/chat', $payload);

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
     * @return array{id: int|string, token: string, url: string}
     */
    public function issueMcpCredentials(AiAgent $agent, ?AiAgentSession $session = null): array
    {
        $agent->loadMissing(['team']);
        $team = $agent->team;
        if ($team === null) {
            throw new \RuntimeException('Agent sans équipe pour MCP.');
        }

        $user = $session?->user;
        if (! $user instanceof User) {
            $user = $team->members()
                ->wherePivotIn('role', ['owner', 'admin'])
                ->orderBy('users.id')
                ->first();
        }

        if (! $user instanceof User) {
            throw new \RuntimeException('Aucun owner/admin pour émettre le jeton MCP.');
        }

        $plainTextToken = sprintf(
            '%s%s%s',
            config('sanctum.token_prefix', ''),
            $tokenEntropy = Str::random(40),
            hash('crc32b', $tokenEntropy)
        );

        $token = $user->tokens()->create([
            'name' => 'devforge-agent-mcp',
            'token' => hash('sha256', $plainTextToken),
            'abilities' => ['read', 'write'],
            'expires_at' => now()->addMinutes(30),
            'team_id' => $team->id,
        ]);

        return [
            'id' => $token->getKey(),
            'token' => $token->getKey().'|'.$plainTextToken,
            'url' => rtrim((string) config('devforge.agent_mcp_url', 'http://api:8080/mcp/devforge'), '/'),
        ];
    }

    public function revokeMcpCredentials(mixed $id): void
    {
        if ($id === null || $id === '') {
            return;
        }

        PersonalAccessToken::query()->whereKey($id)->delete();
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

        return [
            'provider' => (string) $config->provider,
            'base_url' => $this->resolveBaseUrl($config),
            'api_key' => $this->nonEmptyString($config->api_key),
            'model' => $this->resolveConcreteModel($config, $agent),
        ];
    }

    private function resolveConcreteModel(AiProviderConfig $config, ?AiAgent $agent): ?string
    {
        $model = $agent?->preferredLlmModel();
        if ($model !== null && ! LlmModelResolver::isAuto($model)) {
            return $this->nonEmptyString($model);
        }

        $stored = $config->resolvedModel();
        if (! LlmModelResolver::isAuto($stored)) {
            return $this->nonEmptyString($stored);
        }

        $provider = (string) $config->provider;
        $catalogIds = $this->catalogModelIds($config);

        $picked = match ($provider) {
            'ollama' => LlmModelResolver::pickBestOllamaModelForTools($catalogIds)
                ?? LlmProviderRegistry::defaultModel('ollama'),
            'gemini' => (LlmModelResolver::prioritizeGeminiModels($catalogIds)[0] ?? null)
                ?? 'gemini-2.5-flash',
            default => LlmProviderRegistry::defaultModel($provider),
        };

        if (LlmModelResolver::isAuto($picked)) {
            $picked = $catalogIds[0] ?? null;
        }

        return $this->nonEmptyString($picked);
    }

    /** @return list<string> */
    private function catalogModelIds(AiProviderConfig $config): array
    {
        try {
            $rows = app(LlmModelCatalog::class)->listForProvider(
                (string) $config->provider,
                $this->nonEmptyString($config->api_key),
                $this->resolveBaseUrl($config) ?? $this->nonEmptyString($config->base_url),
            );
        } catch (\Throwable) {
            return [];
        }

        $ids = [];
        foreach ($rows as $row) {
            $id = $this->nonEmptyString($row['id'] ?? null);
            if ($id !== null) {
                $ids[] = $id;
            }
        }

        return $ids;
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
