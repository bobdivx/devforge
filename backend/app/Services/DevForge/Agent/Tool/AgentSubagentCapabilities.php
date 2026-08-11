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

    public const PROFILE_FIX_CI = 'fix-ci';

    public const PROFILE_IMPLEMENT = 'implement';

    public const PROFILE_TEST = 'test';

    public const PROFILE_RESEARCH = 'research';

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

        $roleSlug = strtolower(trim((string) ($context['role_slug'] ?? '')));
        if ($roleSlug !== '') {
            $byRole = self::toolsForBusinessRole($roleSlug);
            if ($byRole !== null) {
                return $byRole;
            }
        }

        $profile = strtolower(trim((string) ($context['leaf_profile'] ?? '')));
        $profile = match ($profile) {
            'researcher' => 'researcher',
            'analyst' => 'analyst',
            'writer' => 'writer',
            'reviewer' => self::PROFILE_DIAGNOSE,
            'implementer', 'developer', 'coder' => self::PROFILE_IMPLEMENT,
            'tester', 'qa' => self::PROFILE_TEST,
            default => $profile,
        };

        if (in_array($profile, ['researcher', 'analyst', 'writer'], true)) {
            return self::toolsForBusinessRole($profile);
        }

        return match ($profile) {
            self::PROFILE_DIAGNOSE => self::toolsForBusinessRole('reviewer') ?? [],
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
                'skill_list',
                'skill_load',
                'skill_write',
                'browser_fetch',
                'browser_smoke',
                'checkpoint_list',
                'checkpoint_rollback',
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
                'skill_list',
                'skill_load',
                'browser_fetch',
                'browser_smoke',
                'todo_read',
                'list_tool_packages',
                'enable_tool_package',
            ],
            self::PROFILE_FIX_CI => [
                'list_github_apps',
                'list_github_repos',
                'list_github_branches',
                'list_github_workflows',
                'list_github_workflow_runs',
                'get_github_workflow_run',
                'list_github_workflow_jobs',
                'get_github_workflow_job_logs',
                'rerun_github_workflow_run',
                'dispatch_github_workflow',
                'read_github_file',
                'list_github_dir',
                'write_github_file',
                'create_github_branch',
                'create_github_pull_request',
                'list_github_commits',
                'memory_read',
                'memory_write',
                'todo_read',
                'todo_write',
                'list_tool_packages',
                'enable_tool_package',
            ],
            self::PROFILE_IMPLEMENT => self::toolsForBusinessRole('implementer') ?? [],
            self::PROFILE_TEST => self::toolsForBusinessRole('tester') ?? [],
            self::PROFILE_RESEARCH => self::toolsForBusinessRole('researcher') ?? [],
            default => null,
        };
    }

    /**
     * Allowlists distinctes par rôle métier (P5.1).
     *
     * @return list<string>|null
     */
    public static function toolsForBusinessRole(string $roleSlug): ?array
    {
        $slug = strtolower(trim($roleSlug));
        $slug = str_replace(['_', ' '], '-', $slug);
        $slug = match ($slug) {
            'research' => 'researcher',
            'analyse', 'analysis' => 'analyst',
            'write', 'reporter' => 'writer',
            'review', 'critique', 'diagnose' => 'reviewer',
            'implement', 'developer', 'coder', 'dev' => 'implementer',
            'test', 'qa' => 'tester',
            default => $slug,
        };

        $readCore = [
            'list_resources',
            'get_resource_status',
            'get_application_source_info',
            'list_application_source',
            'read_application_source',
            'get_application_git_info',
            'memory_read',
            'skill_list',
            'skill_load',
            'browser_fetch',
            'browser_smoke',
            'checkpoint_list',
            'todo_read',
            'list_tool_packages',
            'enable_tool_package',
        ];

        return match ($slug) {
            'researcher' => array_values(array_unique([
                ...$readCore,
                'list_github_repos',
                'read_github_file',
                'list_github_dir',
                'web_search',
                'mission_list',
                'mission_create',
                'mission_show',
                'memory_write',
            ])),
            'analyst' => array_values(array_unique([
                ...$readCore,
                'list_github_repos',
                'read_github_file',
                'list_github_dir',
                'web_search',
                'mission_list',
                'mission_show',
                'memory_write',
                'todo_write',
                'get_deployment_logs',
                'get_server_metrics',
            ])),
            'writer' => array_values(array_unique([
                ...$readCore,
                'mission_show',
                'mission_update',
                'memory_write',
                'todo_write',
            ])),
            'reviewer' => array_values(array_unique([
                ...$readCore,
                'get_deployment_logs',
                'list_application_env_vars',
                'get_application_runtime_settings',
                'list_github_branches',
                'read_github_file',
                'list_github_dir',
                'read_remote_file',
                'list_remote_dir',
                'docker_logs',
                'get_server_metrics',
                'web_search',
            ])),
            'implementer' => [
                'list_resources',
                'get_resource_status',
                'get_application_source_info',
                'list_application_source',
                'read_application_source',
                'write_application_source',
                'list_application_env_vars',
                'upsert_application_env_var',
                'get_application_runtime_settings',
                'update_application_runtime_settings',
                'get_application_git_info',
                'list_github_branches',
                'read_github_file',
                'write_github_file',
                'create_github_branch',
                'create_github_pull_request',
                'mission_show',
                'mission_update',
                'request_user_input',
                'memory_read',
                'memory_write',
                'skill_list',
                'skill_load',
                'skill_write',
                'browser_fetch',
                'browser_smoke',
                'checkpoint_list',
                'checkpoint_rollback',
                'todo_read',
                'todo_write',
                'list_tool_packages',
                'enable_tool_package',
                'execute_code',
            ],
            'tester' => [
                'list_resources',
                'get_resource_status',
                'get_application_source_info',
                'list_application_source',
                'read_application_source',
                'run_application_tests',
                'execute_code',
                'exec_command',
                'docker_logs',
                'browser_fetch',
                'browser_smoke',
                'list_github_workflow_runs',
                'get_github_workflow_run',
                'get_github_workflow_job_logs',
                'mission_show',
                'mission_update',
                'memory_read',
                'skill_list',
                'skill_load',
                'todo_read',
                'todo_write',
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
