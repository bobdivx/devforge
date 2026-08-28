<?php

namespace App\Services\DevForge\Agent;

use App\Models\AiProviderConfig;
use App\Models\Team;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;

class AgentDiagnosticsService
{
    /**
     * @return array{checks: list<array<string, mixed>>}
     */
    public function run(Team $team, ?string $check = null): array
    {
        $checks = match ($check) {
            'rig' => [$this->checkRig()],
            'mcp' => $this->checkMcp(),
            'ollama' => $this->checkOllamaProviders($team),
            'gemini' => $this->checkGeminiProviders($team),
            default => [
                $this->checkRig(),
                ...$this->checkMcp(),
                ...$this->checkOllamaProviders($team),
                ...$this->checkGeminiProviders($team),
            ],
        };

        return ['checks' => array_values($checks)];
    }

    /** @return array<string, mixed> */
    private function checkRig(): array
    {
        $started = microtime(true);
        $base = rtrim((string) config('devforge.agent_url'), '/');
        $host = LlmEndpointResolver::urlHost($base);

        if ($base === '') {
            return $this->result(
                id: 'rig-health',
                kind: 'rig',
                label: 'Sidecar Rig',
                status: 'warn',
                message: 'AGENT_URL est vide — le sidecar Rig n’est pas configuré.',
                started: $started,
            );
        }

        try {
            $response = Http::connectTimeout(3)->timeout(6)->get($base.'/health');
        } catch (ConnectionException $exception) {
            return $this->result(
                id: 'rig-health',
                kind: 'rig',
                label: 'Sidecar Rig',
                status: 'fail',
                message: 'Impossible de joindre le sidecar Rig ('.$host.').',
                detail: $this->safeError($exception->getMessage()),
                target: $host,
                started: $started,
            );
        } catch (\Throwable $exception) {
            return $this->result(
                id: 'rig-health',
                kind: 'rig',
                label: 'Sidecar Rig',
                status: 'fail',
                message: 'Erreur en contactant le sidecar Rig ('.$host.').',
                detail: $this->safeError($exception->getMessage()),
                target: $host,
                started: $started,
            );
        }

        $ok = $response->successful()
            && ($response->json('ok') === true || $response->json('service') === 'devforge-agent');
        $statusCode = $response->status();

        return $this->result(
            id: 'rig-health',
            kind: 'rig',
            label: 'Sidecar Rig',
            status: $ok ? 'ok' : 'fail',
            message: $ok
                ? 'Sidecar Rig joignable ('.$host.').'
                : 'Sidecar Rig a répondu HTTP '.$statusCode.' ('.$host.').',
            detail: $ok ? null : mb_substr((string) $response->body(), 0, 240),
            target: $host,
            started: $started,
            httpStatus: $statusCode,
        );
    }

    /** @return list<array<string, mixed>> */
    private function checkMcp(): array
    {
        $results = [$this->probeDevforgeMcp()];

        $registry = app(AgentMcpClientRegistry::class);
        if (! $registry->enabled()) {
            $results[] = $this->result(
                id: 'mcp-client',
                kind: 'mcp',
                label: 'Client MCP distant',
                status: 'warn',
                message: 'Client MCP désactivé (Paramètres AI → MCP).',
                started: microtime(true),
                durationMs: 0,
            );

            return $results;
        }

        $servers = $registry->listServers();
        if ($servers === []) {
            $results[] = $this->result(
                id: 'mcp-remote',
                kind: 'mcp',
                label: 'Serveurs MCP distants',
                status: 'warn',
                message: 'Aucun serveur MCP distant configuré.',
                started: microtime(true),
                durationMs: 0,
            );

            return $results;
        }

        foreach ($servers as $server) {
            $results[] = $this->probeRemoteMcp($server);
        }

        return $results;
    }

    /** @return array<string, mixed> */
    private function probeDevforgeMcp(): array
    {
        $started = microtime(true);
        $url = rtrim((string) config('devforge.agent_mcp_url', 'http://api:8080/mcp/devforge'), '/');
        $host = LlmEndpointResolver::urlHost($url) ?? $url;

        try {
            $response = Http::withHeaders([
                'Accept' => 'application/json, text/event-stream',
                'Content-Type' => 'application/json',
            ])
                ->connectTimeout(3)
                ->timeout(8)
                ->post($url, [
                    'jsonrpc' => '2.0',
                    'id' => 1,
                    'method' => 'initialize',
                    'params' => [
                        'protocolVersion' => '2024-11-05',
                        'capabilities' => new \stdClass,
                        'clientInfo' => [
                            'name' => 'devforge-diagnostics',
                            'version' => '1.0.0',
                        ],
                    ],
                ]);
        } catch (ConnectionException $exception) {
            return $this->result(
                id: 'mcp-devforge',
                kind: 'mcp',
                label: 'MCP DevForge',
                status: 'fail',
                message: 'MCP DevForge injoignable ('.$host.').',
                detail: $this->safeError($exception->getMessage()),
                target: $host,
                started: $started,
            );
        } catch (\Throwable $exception) {
            return $this->result(
                id: 'mcp-devforge',
                kind: 'mcp',
                label: 'MCP DevForge',
                status: 'fail',
                message: 'Erreur MCP DevForge ('.$host.').',
                detail: $this->safeError($exception->getMessage()),
                target: $host,
                started: $started,
            );
        }

        $statusCode = $response->status();
        if (in_array($statusCode, [401, 403], true)) {
            return $this->result(
                id: 'mcp-devforge',
                kind: 'mcp',
                label: 'MCP DevForge',
                status: 'ok',
                message: 'MCP DevForge joignable (auth requise, normal sans jeton).',
                target: $host,
                started: $started,
                httpStatus: $statusCode,
            );
        }

        if ($response->successful()) {
            return $this->result(
                id: 'mcp-devforge',
                kind: 'mcp',
                label: 'MCP DevForge',
                status: 'ok',
                message: 'MCP DevForge a accepté initialize.',
                target: $host,
                started: $started,
                httpStatus: $statusCode,
            );
        }

        return $this->result(
            id: 'mcp-devforge',
            kind: 'mcp',
            label: 'MCP DevForge',
            status: 'fail',
            message: 'MCP DevForge HTTP '.$statusCode.' ('.$host.').',
            detail: mb_substr((string) $response->body(), 0, 240),
            target: $host,
            started: $started,
            httpStatus: $statusCode,
        );
    }

    /**
     * @param  array{id: string, url: string, label: string}  $server
     * @return array<string, mixed>
     */
    private function probeRemoteMcp(array $server): array
    {
        $started = microtime(true);
        $host = LlmEndpointResolver::urlHost($server['url']) ?? $server['id'];
        $label = 'MCP '.$server['label'];

        try {
            $client = new AgentMcpHttpClient($server['url'], timeout: 8);
            $tools = $client->listTools();
            $count = count($tools);

            return $this->result(
                id: 'mcp-remote-'.$server['id'],
                kind: 'mcp',
                label: $label,
                status: 'ok',
                message: $count === 0
                    ? 'Serveur MCP joignable, aucun outil exposé.'
                    : "Serveur MCP joignable — {$count} outil(s).",
                target: $host,
                started: $started,
            );
        } catch (\Throwable $exception) {
            return $this->result(
                id: 'mcp-remote-'.$server['id'],
                kind: 'mcp',
                label: $label,
                status: 'fail',
                message: 'Serveur MCP injoignable ('.$host.').',
                detail: $this->safeError($exception->getMessage()),
                target: $host,
                started: $started,
            );
        }
    }

    /** @return list<array<string, mixed>> */
    private function checkOllamaProviders(Team $team): array
    {
        $configs = AiProviderConfig::query()
            ->where('team_id', $team->id)
            ->where('provider', 'ollama')
            ->orderByDesc('is_default')
            ->orderBy('id')
            ->get();

        if ($configs->isEmpty()) {
            return [$this->result(
                id: 'ollama-none',
                kind: 'ollama',
                label: 'Ollama',
                status: 'warn',
                message: 'Aucun provider Ollama configuré.',
                started: microtime(true),
                durationMs: 0,
            )];
        }

        $checks = [];
        foreach ($configs as $config) {
            $checks[] = $this->checkOneOllama($config);
        }

        return $checks;
    }

    /** @return array<string, mixed> */
    private function checkOneOllama(AiProviderConfig $config): array
    {
        $started = microtime(true);
        $label = 'Ollama · '.$config->name;
        $id = 'ollama-'.$config->id;
        $rawUrl = (string) $config->base_url;

        try {
            $baseUrl = LlmEndpointResolver::ollamaBaseUrl($config->base_url);
        } catch (\Throwable $exception) {
            return $this->result(
                id: $id,
                kind: 'ollama',
                label: $label,
                status: 'fail',
                message: $this->safeError($exception->getMessage()),
                target: LlmEndpointResolver::urlHost($rawUrl),
                started: $started,
            );
        }

        $host = LlmEndpointResolver::urlHost($baseUrl) ?? $baseUrl;
        $tunnel = LlmEndpointResolver::isPublicHttpsTunnel($rawUrl)
            || LlmEndpointResolver::isPublicHttpsTunnel($baseUrl);

        try {
            $tags = Http::connectTimeout(4)->timeout(8)->get(rtrim($baseUrl, '/').'/api/tags');
        } catch (ConnectionException $exception) {
            return $this->result(
                id: $id,
                kind: 'ollama',
                label: $label,
                status: 'fail',
                message: 'Ollama injoignable ('.$host.').'
                    .($tunnel ? ' Un tunnel HTTPS/Cloudflare casse souvent cette connexion.' : ''),
                detail: $this->safeError($exception->getMessage()),
                target: $host,
                started: $started,
            );
        } catch (\Throwable $exception) {
            return $this->result(
                id: $id,
                kind: 'ollama',
                label: $label,
                status: 'fail',
                message: 'Erreur Ollama ('.$host.').',
                detail: $this->safeError($exception->getMessage()),
                target: $host,
                started: $started,
            );
        }

        if ($tags->failed()) {
            $hint = $tags->status() === 502
                ? ' HTTP 502 : un tunnel Cloudflare bloque souvent /api/tags et /v1/chat/completions. Utilisez une IP LAN (ex. http://10.1.0.58:11434).'
                : '';

            return $this->result(
                id: $id,
                kind: 'ollama',
                label: $label,
                status: 'fail',
                message: 'Ollama HTTP '.$tags->status().' sur /api/tags ('.$host.').'.$hint,
                detail: mb_substr((string) $tags->body(), 0, 240),
                target: $host,
                started: $started,
                httpStatus: $tags->status(),
            );
        }

        $models = collect($tags->json('models', []))
            ->map(fn ($row): string => is_array($row) ? (string) ($row['name'] ?? '') : '')
            ->filter()
            ->values()
            ->all();

        $smoke = $this->smokeOllamaChat($baseUrl, $models[0] ?? null);
        $status = 'ok';
        $message = count($models).' modèle(s) listé(s) sur '.$host.'.';
        if ($smoke['ok'] === true) {
            $message .= ' Smoke /v1/chat/completions OK.';
        } elseif ($smoke['error'] !== null) {
            $status = 'warn';
            $message .= ' Smoke chat : '.$smoke['error'];
        }

        if ($tunnel) {
            $status = $status === 'ok' ? 'warn' : $status;
            $message .= ' URL HTTPS publique (tunnel) : préférez une IP LAN, ex. http://10.1.0.58:11434.';
        }

        return $this->result(
            id: $id,
            kind: 'ollama',
            label: $label,
            status: $status,
            message: $message,
            detail: $smoke['error'],
            target: $host,
            started: $started,
            httpStatus: $tags->status(),
            models: array_slice($models, 0, 12),
        );
    }

    /**
     * @return array{ok: bool, error: string|null}
     */
    private function smokeOllamaChat(string $baseUrl, ?string $model): array
    {
        if ($model === null || $model === '') {
            return ['ok' => false, 'error' => 'Aucun modèle à tester.'];
        }

        $openaiBase = rtrim($baseUrl, '/');
        if (! str_ends_with($openaiBase, '/v1')) {
            $openaiBase .= '/v1';
        }

        try {
            $response = Http::connectTimeout(4)
                ->timeout(15)
                ->post($openaiBase.'/chat/completions', [
                    'model' => $model,
                    'messages' => [
                        ['role' => 'user', 'content' => 'Reply with OK'],
                    ],
                    'max_tokens' => 8,
                    'stream' => false,
                ]);
        } catch (ConnectionException $exception) {
            return ['ok' => false, 'error' => $this->safeError($exception->getMessage())];
        } catch (\Throwable $exception) {
            return ['ok' => false, 'error' => $this->safeError($exception->getMessage())];
        }

        if ($response->successful()) {
            return ['ok' => true, 'error' => null];
        }

        $hint = $response->status() === 502
            ? ' Tunnel Cloudflare / 502 sur /v1/chat/completions.'
            : '';

        return [
            'ok' => false,
            'error' => 'HTTP '.$response->status().$hint.' '.mb_substr((string) $response->body(), 0, 160),
        ];
    }

    /** @return list<array<string, mixed>> */
    private function checkGeminiProviders(Team $team): array
    {
        $configs = AiProviderConfig::query()
            ->where('team_id', $team->id)
            ->where('provider', 'gemini')
            ->orderByDesc('is_default')
            ->orderBy('id')
            ->get();

        if ($configs->isEmpty()) {
            return [$this->result(
                id: 'gemini-none',
                kind: 'gemini',
                label: 'Gemini',
                status: 'warn',
                message: 'Aucun provider Gemini configuré.',
                started: microtime(true),
                durationMs: 0,
            )];
        }

        $checks = [];
        foreach ($configs as $config) {
            $checks[] = $this->checkOneGemini($config);
        }

        return $checks;
    }

    /** @return array<string, mixed> */
    private function checkOneGemini(AiProviderConfig $config): array
    {
        $started = microtime(true);
        $label = 'Gemini · '.$config->name;
        $id = 'gemini-'.$config->id;
        $baseUrl = LlmEndpointResolver::geminiBaseUrl($config->base_url);
        $host = LlmEndpointResolver::urlHost($baseUrl) ?? 'generativelanguage.googleapis.com';
        $apiKey = trim((string) $config->api_key);

        if ($apiKey === '') {
            return $this->result(
                id: $id,
                kind: 'gemini',
                label: $label,
                status: 'fail',
                message: 'Clé API Gemini manquante.',
                target: $host,
                started: $started,
            );
        }

        try {
            $response = Http::withHeaders([
                'Authorization' => 'Bearer '.$apiKey,
                'Accept' => 'application/json',
            ])
                ->connectTimeout(4)
                ->timeout(12)
                ->get(rtrim($baseUrl, '/').'/models');
        } catch (ConnectionException $exception) {
            return $this->result(
                id: $id,
                kind: 'gemini',
                label: $label,
                status: 'fail',
                message: 'Gemini injoignable ('.$host.').',
                detail: $this->safeError($exception->getMessage()),
                target: $host,
                started: $started,
            );
        } catch (\Throwable $exception) {
            return $this->result(
                id: $id,
                kind: 'gemini',
                label: $label,
                status: 'fail',
                message: 'Erreur Gemini ('.$host.').',
                detail: $this->safeError($exception->getMessage()),
                target: $host,
                started: $started,
            );
        }

        $statusCode = $response->status();
        if ($statusCode === 429) {
            return $this->result(
                id: $id,
                kind: 'gemini',
                label: $label,
                status: 'warn',
                message: 'Quota Gemini dépassé (HTTP 429). Réessayez plus tard — le provider est configuré mais limité.',
                target: $host,
                started: $started,
                httpStatus: 429,
            );
        }

        if ($response->failed()) {
            return $this->result(
                id: $id,
                kind: 'gemini',
                label: $label,
                status: 'fail',
                message: 'Gemini HTTP '.$statusCode.' ('.$host.').',
                detail: mb_substr((string) $response->body(), 0, 240),
                target: $host,
                started: $started,
                httpStatus: $statusCode,
            );
        }

        $models = collect($response->json('data', []))
            ->map(function ($row): string {
                if (! is_array($row)) {
                    return '';
                }
                $modelId = (string) ($row['id'] ?? '');

                return (string) (preg_replace('/^models\//i', '', $modelId) ?? $modelId);
            })
            ->filter()
            ->values()
            ->all();

        return $this->result(
            id: $id,
            kind: 'gemini',
            label: $label,
            status: 'ok',
            message: count($models).' modèle(s) Gemini listé(s).',
            target: $host,
            started: $started,
            httpStatus: $statusCode,
            models: array_slice($models, 0, 12),
        );
    }

    /**
     * @param  list<string>|null  $models
     * @return array<string, mixed>
     */
    private function result(
        string $id,
        string $kind,
        string $label,
        string $status,
        string $message,
        float $started,
        ?string $detail = null,
        ?string $target = null,
        ?int $httpStatus = null,
        ?array $models = null,
        ?int $durationMs = null,
    ): array {
        $payload = [
            'id' => $id,
            'kind' => $kind,
            'label' => $label,
            'status' => $status,
            'message' => $message,
            'detail' => $detail,
            'target' => $target,
            'duration_ms' => $durationMs ?? (int) round((microtime(true) - $started) * 1000),
            'http_status' => $httpStatus,
        ];
        if ($models !== null) {
            $payload['models'] = $models;
        }

        return $payload;
    }

    private function safeError(string $raw): string
    {
        $redacted = preg_replace('/(Bearer\s+)\S+/i', '$1[redacted]', $raw) ?? $raw;
        $redacted = preg_replace('/\b(sk-|AIza)[A-Za-z0-9_\-]+/', '[redacted]', $redacted) ?? $redacted;
        $redacted = preg_replace('/(api[_-]?key=)[^&\s]+/i', '$1[redacted]', $redacted) ?? $redacted;

        return mb_substr($redacted, 0, 300);
    }
}
