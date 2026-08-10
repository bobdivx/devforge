<?php

namespace App\Services\DevForge\Agent;

use App\Models\AiAgent;

/**
 * Registre des serveurs MCP distants pour la boucle agent (P6).
 *
 * Config : Paramètres instance (agents_features) + override agent metadata.mcp_servers.
 */
class AgentMcpClientRegistry
{
    /** @var array<string, AgentMcpHttpClient> */
    private array $clients = [];

    /** @var array<string, list<array<string, mixed>>> */
    private array $toolCache = [];

    public function enabled(): bool
    {
        return app(AgentRuntimeSettings::class)->mcpClientEnabled();
    }

    /**
     * @return list<array{id: string, url: string, label: string}>
     */
    public function listServers(?AiAgent $agent = null): array
    {
        if (! $this->enabled()) {
            return [];
        }

        return array_values(array_map(static fn (array $server): array => [
            'id' => (string) $server['id'],
            'url' => (string) $server['url'],
            'label' => (string) ($server['label'] ?? $server['id']),
        ], $this->resolvedServers($agent)));
    }

    /**
     * @return list<array{name: string, description: string, parameters: array<mixed>, mcp_server: string, mcp_tool: string}>
     */
    public function toolDefinitions(?AiAgent $agent = null): array
    {
        if (! $this->enabled()) {
            return [];
        }

        $definitions = [];
        foreach ($this->resolvedServers($agent) as $server) {
            $serverId = (string) $server['id'];
            try {
                $remoteTools = $this->listRemoteTools($serverId, $agent);
            } catch (\Throwable $exception) {
                $definitions[] = [
                    'name' => $this->encodeToolName($serverId, '_error'),
                    'description' => 'Serveur MCP « '.$serverId.' » indisponible: '.mb_substr($exception->getMessage(), 0, 200),
                    'parameters' => ['type' => 'object', 'properties' => (object) []],
                    'mcp_server' => $serverId,
                    'mcp_tool' => '_error',
                ];

                continue;
            }

            foreach ($remoteTools as $tool) {
                $remoteName = (string) ($tool['name'] ?? '');
                if ($remoteName === '' || $remoteName === '_error') {
                    continue;
                }
                $inputSchema = is_array($tool['inputSchema'] ?? null)
                    ? $tool['inputSchema']
                    : ['type' => 'object', 'properties' => (object) []];

                $definitions[] = [
                    'name' => $this->encodeToolName($serverId, $remoteName),
                    'description' => '[MCP:'.$serverId.'] '.((string) ($tool['description'] ?? $remoteName)),
                    'parameters' => $inputSchema,
                    'mcp_server' => $serverId,
                    'mcp_tool' => $remoteName,
                ];
            }
        }

        return $definitions;
    }

    /**
     * @param  array<string, mixed>  $arguments
     * @return array<string, mixed>
     */
    public function callEncodedTool(string $encodedName, array $arguments, ?AiAgent $agent = null): array
    {
        if (! $this->enabled()) {
            return ['error' => 'Client MCP désactivé (Paramètres → Avancé → Agents).'];
        }

        $parsed = $this->decodeToolName($encodedName);
        if ($parsed === null) {
            return ['error' => 'Nom d’outil MCP invalide.'];
        }

        if ($parsed['tool'] === '_error') {
            return ['error' => 'Serveur MCP indisponible — vérifie URL/token.'];
        }

        try {
            $client = $this->clientFor($parsed['server'], $agent);
            $result = $client->callTool($parsed['tool'], $arguments);

            return [
                'ok' => true,
                'mcp_server' => $parsed['server'],
                'mcp_tool' => $parsed['tool'],
                'result' => $this->normalizeCallResult($result),
            ];
        } catch (\Throwable $exception) {
            return [
                'error' => mb_substr($exception->getMessage(), 0, 500),
                'mcp_server' => $parsed['server'],
                'mcp_tool' => $parsed['tool'],
            ];
        }
    }

    public function isMcpTool(string $toolName): bool
    {
        return str_starts_with($toolName, 'mcp__')
            || in_array($toolName, ['mcp_list_servers', 'mcp_list_remote_tools'], true);
    }

    public function encodeToolName(string $serverId, string $toolName): string
    {
        $serverId = $this->sanitizeServerId($serverId);
        $toolName = (string) preg_replace('/[^a-zA-Z0-9_\-.]/', '_', $toolName);

        return 'mcp__'.$serverId.'__'.$toolName;
    }

    /**
     * @return array{server: string, tool: string}|null
     */
    public function decodeToolName(string $name): ?array
    {
        if (preg_match('/^mcp__([a-z0-9\-]+)__(.+)$/i', $name, $matches) !== 1) {
            return null;
        }

        return [
            'server' => strtolower($matches[1]),
            'tool' => $matches[2],
        ];
    }

    public function refresh(?AiAgent $agent = null): void
    {
        $this->toolCache = [];
        $this->clients = [];
        foreach ($this->resolvedServers($agent) as $server) {
            try {
                $this->listRemoteTools((string) $server['id'], $agent, force: true);
            } catch (\Throwable) {
                // ignore per-server
            }
        }
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function listRemoteTools(string $serverId, ?AiAgent $agent, bool $force = false): array
    {
        $serverId = $this->sanitizeServerId($serverId);
        if (! $force && isset($this->toolCache[$serverId])) {
            return $this->toolCache[$serverId];
        }

        $tools = $this->clientFor($serverId, $agent)->listTools();
        $this->toolCache[$serverId] = $tools;

        return $tools;
    }

    private function clientFor(string $serverId, ?AiAgent $agent): AgentMcpHttpClient
    {
        $serverId = $this->sanitizeServerId($serverId);
        if (isset($this->clients[$serverId])) {
            return $this->clients[$serverId];
        }

        $server = null;
        foreach ($this->resolvedServers($agent) as $candidate) {
            if ($this->sanitizeServerId((string) $candidate['id']) === $serverId) {
                $server = $candidate;
                break;
            }
        }

        if ($server === null) {
            throw new \InvalidArgumentException("Serveur MCP inconnu: {$serverId}");
        }

        $headers = [];
        if (is_array($server['headers'] ?? null)) {
            foreach ($server['headers'] as $key => $value) {
                if (is_string($key) && (is_string($value) || is_numeric($value))) {
                    $headers[$key] = (string) $value;
                }
            }
        }

        $token = (string) ($server['token'] ?? '');
        if ($token === '' && ! empty($server['token_env'])) {
            $token = (string) env((string) $server['token_env'], '');
        }
        if ($token !== '') {
            $headers['Authorization'] = str_starts_with($token, 'Bearer ') ? $token : 'Bearer '.$token;
        }

        $timeout = max(5, (int) ($server['timeout'] ?? config('devforge.agents_mcp_client_timeout', 30)));

        $this->clients[$serverId] = new AgentMcpHttpClient(
            url: (string) $server['url'],
            headers: $headers,
            timeout: $timeout,
        );

        return $this->clients[$serverId];
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function resolvedServers(?AiAgent $agent): array
    {
        $fromInstance = app(AgentRuntimeSettings::class)->mcpServers();
        $fromAgent = [];
        if ($agent !== null && is_array($agent->metadata['mcp_servers'] ?? null)) {
            $fromAgent = $this->normalizeServerList($agent->metadata['mcp_servers']);
        }

        $byId = [];
        foreach ([...$fromInstance, ...$fromAgent] as $server) {
            $byId[$this->sanitizeServerId((string) $server['id'])] = $server;
        }

        return array_values($byId);
    }

    /**
     * @param  mixed  $raw
     * @return list<array<string, mixed>>
     */
    private function normalizeServerList(mixed $raw): array
    {
        if (is_string($raw) && trim($raw) !== '') {
            $decoded = json_decode($raw, true);
            $raw = is_array($decoded) ? $decoded : [];
        }

        if (! is_array($raw)) {
            return [];
        }

        $out = [];
        foreach ($raw as $item) {
            if (! is_array($item)) {
                continue;
            }
            $id = $this->sanitizeServerId((string) ($item['id'] ?? ''));
            $url = trim((string) ($item['url'] ?? ''));
            if ($id === '' || $url === '') {
                continue;
            }
            $out[] = array_merge($item, [
                'id' => $id,
                'url' => $url,
                'label' => (string) ($item['label'] ?? $id),
            ]);
        }

        return $out;
    }

    private function sanitizeServerId(string $id): string
    {
        $id = strtolower(trim($id));

        return (string) preg_replace('/[^a-z0-9\-]/', '-', $id);
    }

    /**
     * @param  array<string, mixed>  $result
     * @return array<string, mixed>|string
     */
    private function normalizeCallResult(array $result): array|string
    {
        if (isset($result['content']) && is_array($result['content'])) {
            $texts = [];
            foreach ($result['content'] as $block) {
                if (is_array($block) && ($block['type'] ?? '') === 'text') {
                    $texts[] = (string) ($block['text'] ?? '');
                }
            }
            if ($texts !== []) {
                $joined = implode("\n", $texts);
                $json = json_decode($joined, true);

                return is_array($json) ? $json : $joined;
            }
        }

        return $result;
    }
}
