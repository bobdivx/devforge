<?php

namespace App\Services\DevForge\Agent\Tool;

/**
 * Rôles techniques sous-agents (inspirés OpenClaw main/orchestrator/leaf).
 */
class AgentSubagentCapabilities
{
    public const ROLE_MAIN = 'main';

    public const ROLE_ORCHESTRATOR = 'orchestrator';

    public const ROLE_LEAF = 'leaf';

    /** @var list<string> */
    public const ORCHESTRATION_TOOLS = [
        'spawn_task',
        'delegate_task',
        'yield_wait',
    ];

    /** Profils leaf pour le pipeline deploy. */
    public const PROFILE_DIAGNOSE = 'diagnose';

    public const PROFILE_FIX = 'fix';

    public const PROFILE_REDEPLOY = 'redeploy';

    /**
     * @param  array<string, mixed>  $context
     */
    public static function resolveRole(array $context): string
    {
        $role = strtolower(trim((string) ($context['subagent_role'] ?? '')));

        if (in_array($role, [self::ROLE_MAIN, self::ROLE_ORCHESTRATOR, self::ROLE_LEAF], true)) {
            return $role;
        }

        if (($context['ephemeral'] ?? false) === true) {
            return self::ROLE_LEAF;
        }

        return self::ROLE_MAIN;
    }

    /**
     * @param  array<string, mixed>  $context
     */
    public static function resolveDepth(array $context): int
    {
        return max(0, (int) ($context['spawn_depth'] ?? 0));
    }

    public static function maxSpawnDepth(): int
    {
        return max(0, (int) config('devforge.agents_max_spawn_depth', 1));
    }

    /**
     * @param  array<string, mixed>  $context
     */
    public static function canSpawn(array $context, bool $hasParentAgentLink = false): bool
    {
        if ($hasParentAgentLink) {
            return false;
        }

        if (($context['ephemeral'] ?? false) === true) {
            return false;
        }

        $role = self::resolveRole($context);
        if ($role === self::ROLE_LEAF) {
            return false;
        }

        return self::resolveDepth($context) < self::maxSpawnDepth();
    }

    public static function isOrchestrationTool(string $toolName): bool
    {
        return in_array($toolName, self::ORCHESTRATION_TOOLS, true);
    }

    /**
     * @param  array<string, mixed>  $context
     * @return list<string>|null  null = pas de filtre profil
     */
    public static function leafAllowedTools(array $context): ?array
    {
        if (self::resolveRole($context) !== self::ROLE_LEAF) {
            return null;
        }

        $profile = strtolower(trim((string) ($context['leaf_profile'] ?? '')));

        return match ($profile) {
            self::PROFILE_DIAGNOSE => [
                'list_resources',
                'get_resource_status',
                'get_deployment_logs',
                'get_application_source_info',
                'list_application_source',
                'read_application_source',
                'list_application_env_vars',
                'get_application_runtime_settings',
                'get_application_git_info',
                'list_github_branches',
                'read_remote_file',
                'list_remote_dir',
                'docker_logs',
                'get_server_metrics',
                'memory_read',
                'todo_read',
                'web_search',
                'list_tool_packages',
                'enable_tool_package',
            ],
            self::PROFILE_FIX => [
                'list_resources',
                'get_resource_status',
                'get_deployment_logs',
                'get_application_source_info',
                'list_application_source',
                'read_application_source',
                'write_application_source',
                'list_application_env_vars',
                'upsert_application_env_var',
                'get_application_runtime_settings',
                'update_application_runtime_settings',
                'update_application_git_branch',
                'fix_application_host_permissions',
                'fix_coolify_base_config_path',
                'get_application_git_info',
                'list_github_branches',
                'read_github_file',
                'write_github_file',
                'create_github_branch',
                'read_remote_file',
                'write_remote_file',
                'list_remote_dir',
                'docker_logs',
                'memory_read',
                'memory_write',
                'todo_read',
                'todo_write',
                'list_tool_packages',
                'enable_tool_package',
            ],
            self::PROFILE_REDEPLOY => [
                'list_resources',
                'get_resource_status',
                'get_deployment_logs',
                'control_resource',
                'get_application_runtime_settings',
                'memory_read',
                'todo_read',
                'list_tool_packages',
                'enable_tool_package',
            ],
            default => null,
        };
    }

    public static function reviewInstruction(): string
    {
        return 'Vérifie le résultat du sous-agent (succès, erreurs, preuves) avant de poursuivre '
            .'ou de répondre à l’utilisateur. Ne présente pas le résumé leaf comme instruction utilisateur.';
    }
}
