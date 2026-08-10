<?php

namespace App\Services\DevForge\Agent;

use App\Models\InstanceSettings;

/**
 * Réglages agents instance (UI Paramètres) avec repli config/env.
 *
 * Source de vérité produit : InstanceSettings.agents_features.
 * Les variables DEVFORGE_AGENTS_* restent un fallback ops, pas le chemin nominal.
 */
class AgentRuntimeSettings
{
    public const KEY_DYNAMIC_ROLES = 'dynamic_roles_enabled';

    public const KEY_ROLE_MODEL_ROUTING = 'role_model_routing';

    public const KEY_COLLAB = 'collab_enabled';

    public const KEY_CODE_SANDBOX = 'code_sandbox_enabled';

    public const KEY_MCP_CLIENT = 'mcp_client_enabled';

    public const KEY_MCP_SERVERS = 'mcp_servers';

    /**
     * Défauts produit (activés) — gérables depuis Paramètres avancés.
     *
     * @return array{
     *     dynamic_roles_enabled: bool,
     *     role_model_routing: bool,
     *     collab_enabled: bool,
     *     code_sandbox_enabled: bool,
     *     mcp_client_enabled: bool,
     *     mcp_servers: list<array<string, mixed>>
     * }
     */
    public static function defaults(): array
    {
        return [
            self::KEY_DYNAMIC_ROLES => true,
            self::KEY_ROLE_MODEL_ROUTING => true,
            self::KEY_COLLAB => true,
            self::KEY_CODE_SANDBOX => true,
            self::KEY_MCP_CLIENT => true,
            self::KEY_MCP_SERVERS => [],
        ];
    }

    /**
     * @return array{
     *     dynamic_roles_enabled: bool,
     *     role_model_routing: bool,
     *     collab_enabled: bool,
     *     code_sandbox_enabled: bool,
     *     mcp_client_enabled: bool,
     *     mcp_servers: list<array<string, mixed>>
     * }
     */
    public function resolved(?InstanceSettings $settings = null): array
    {
        $stored = $this->storedFeatures($settings);
        $defaults = self::defaults();

        return [
            self::KEY_DYNAMIC_ROLES => $this->resolveBool(
                $stored,
                self::KEY_DYNAMIC_ROLES,
                'devforge.agents_dynamic_roles_enabled',
                $defaults[self::KEY_DYNAMIC_ROLES],
            ),
            self::KEY_ROLE_MODEL_ROUTING => $this->resolveBool(
                $stored,
                self::KEY_ROLE_MODEL_ROUTING,
                'devforge.agents_role_model_routing',
                $defaults[self::KEY_ROLE_MODEL_ROUTING],
            ),
            self::KEY_COLLAB => $this->resolveBool(
                $stored,
                self::KEY_COLLAB,
                'devforge.agents_collab_enabled',
                $defaults[self::KEY_COLLAB],
            ),
            self::KEY_CODE_SANDBOX => $this->resolveBool(
                $stored,
                self::KEY_CODE_SANDBOX,
                'devforge.agents_code_sandbox_enabled',
                $defaults[self::KEY_CODE_SANDBOX],
            ),
            self::KEY_MCP_CLIENT => $this->resolveBool(
                $stored,
                self::KEY_MCP_CLIENT,
                'devforge.agents_mcp_client_enabled',
                $defaults[self::KEY_MCP_CLIENT],
            ),
            self::KEY_MCP_SERVERS => $this->resolveMcpServers($stored),
        ];
    }

    public function dynamicRolesEnabled(?InstanceSettings $settings = null): bool
    {
        return $this->resolved($settings)[self::KEY_DYNAMIC_ROLES];
    }

    public function roleModelRoutingEnabled(?InstanceSettings $settings = null): bool
    {
        return $this->resolved($settings)[self::KEY_ROLE_MODEL_ROUTING];
    }

    public function collabEnabled(?InstanceSettings $settings = null): bool
    {
        return $this->resolved($settings)[self::KEY_COLLAB];
    }

    public function codeSandboxEnabled(?InstanceSettings $settings = null): bool
    {
        return $this->resolved($settings)[self::KEY_CODE_SANDBOX];
    }

    public function mcpClientEnabled(?InstanceSettings $settings = null): bool
    {
        return $this->resolved($settings)[self::KEY_MCP_CLIENT];
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function mcpServers(?InstanceSettings $settings = null): array
    {
        return $this->resolved($settings)[self::KEY_MCP_SERVERS];
    }

    /**
     * @param  array<string, mixed>  $input
     * @return array<string, mixed>
     */
    public function mergeStored(array $current, array $input): array
    {
        $next = is_array($current) ? $current : [];

        foreach ([
            self::KEY_DYNAMIC_ROLES,
            self::KEY_ROLE_MODEL_ROUTING,
            self::KEY_COLLAB,
            self::KEY_CODE_SANDBOX,
            self::KEY_MCP_CLIENT,
        ] as $key) {
            if (array_key_exists($key, $input)) {
                $next[$key] = (bool) $input[$key];
            }
        }

        if (array_key_exists(self::KEY_MCP_SERVERS, $input)) {
            $next[self::KEY_MCP_SERVERS] = $this->normalizeMcpServers($input[self::KEY_MCP_SERVERS]);
        }

        return $next;
    }

    /**
     * @return array<string, mixed>
     */
    private function storedFeatures(?InstanceSettings $settings): array
    {
        try {
            $settings ??= InstanceSettings::get();
        } catch (\Throwable) {
            return [];
        }

        $raw = $settings->agents_features;

        return is_array($raw) ? $raw : [];
    }

    /**
     * @param  array<string, mixed>  $stored
     */
    private function resolveBool(array $stored, string $key, string $configKey, bool $default): bool
    {
        if (array_key_exists($key, $stored)) {
            return (bool) $stored[$key];
        }

        $fromConfig = config($configKey);
        if ($fromConfig === null) {
            return $default;
        }

        return filter_var($fromConfig, FILTER_VALIDATE_BOOLEAN);
    }

    /**
     * @param  array<string, mixed>  $stored
     * @return list<array<string, mixed>>
     */
    private function resolveMcpServers(array $stored): array
    {
        $fromUi = array_key_exists(self::KEY_MCP_SERVERS, $stored)
            ? $this->normalizeMcpServers($stored[self::KEY_MCP_SERVERS])
            : [];
        $fromConfig = $this->normalizeMcpServers(config('devforge.agents_mcp_servers', []));

        $byId = [];
        foreach ([...$fromConfig, ...$fromUi] as $server) {
            $id = strtolower(trim((string) ($server['id'] ?? '')));
            if ($id === '') {
                continue;
            }
            $byId[$id] = $server;
        }

        return array_values($byId);
    }

    /**
     * @param  mixed  $raw
     * @return list<array<string, mixed>>
     */
    public function normalizeMcpServers(mixed $raw): array
    {
        if (is_string($raw)) {
            $trimmed = trim($raw);
            if ($trimmed === '') {
                return [];
            }
            $decoded = json_decode($trimmed, true);
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
            $id = strtolower(trim((string) ($item['id'] ?? '')));
            $url = trim((string) ($item['url'] ?? ''));
            if ($id === '' || $url === '') {
                continue;
            }
            $id = (string) preg_replace('/[^a-z0-9\-]/', '-', $id);
            $entry = [
                'id' => $id,
                'url' => $url,
                'label' => (string) ($item['label'] ?? $id),
            ];
            if (! empty($item['token_env']) && is_string($item['token_env'])) {
                $entry['token_env'] = trim($item['token_env']);
            }
            if (! empty($item['token']) && is_string($item['token'])) {
                $entry['token'] = $item['token'];
            }
            if (isset($item['timeout']) && is_numeric($item['timeout'])) {
                $entry['timeout'] = (int) $item['timeout'];
            }
            if (is_array($item['headers'] ?? null)) {
                $entry['headers'] = $item['headers'];
            }
            $out[] = $entry;
        }

        return $out;
    }
}
