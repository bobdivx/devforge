<?php

namespace App\Services\DevForge\Agent\Tool;

/**
 * Paquets d'outils activables dynamiquement par les agents (porté depuis Forge).
 */
class AgentToolPackage
{
    public const PACKAGE_CORE = 'core';

    public const PACKAGE_GITHUB = 'github';

    /** Outils méta toujours disponibles (hors paquets). */
    public const META_TOOLS = [
        'enable_tool_package',
        'list_tool_packages',
        'install_tool',
        'request_tool',
    ];

    /**
     * @return array<string, array{id: string, label: string, description: string, tools: string[], default_for_types: string[]}>
     */
    public static function catalog(): array
    {
        return [
            self::PACKAGE_CORE => [
                'id' => self::PACKAGE_CORE,
                'label' => 'Infra DevForge',
                'description' => 'Ressources Coolify, déploiements, SSH, Docker, HTTP.',
                'tools' => [
                    'list_resources',
                    'get_resource_status',
                    'get_deployment_logs',
                    'control_resource',
                    'get_server_metrics',
                    'send_notification',
                    'exec_command',
                    'get_application_source_info',
                    'list_application_source',
                    'read_application_source',
                    'write_application_source',
                    'read_remote_file',
                    'list_remote_dir',
                    'search_remote_files',
                    'docker_logs',
                    'http_request',
                    'write_remote_file',
                    'delegate_task',
                ],
                'default_for_types' => ['debug', 'deployment', 'tech-watch', 'devforge', 'security'],
            ],
            self::PACKAGE_GITHUB => [
                'id' => self::PACKAGE_GITHUB,
                'label' => 'GitHub API',
                'description' => 'Apps GitHub, dépôts, branches, fichiers source, infos git des applications.',
                'tools' => [
                    'list_github_apps',
                    'list_github_repos',
                    'list_github_branches',
                    'read_github_file',
                    'list_github_dir',
                    'get_application_git_info',
                    'list_github_pull_requests',
                    'get_github_pull_request',
                    'list_github_workflow_runs',
                    'get_github_workflow_run',
                    'list_github_commits',
                ],
                'default_for_types' => ['github', 'debug', 'deployment', 'devforge', 'tech-watch'],
            ],
        ];
    }

    public static function exists(string $packageId): bool
    {
        return isset(self::catalog()[$packageId]);
    }

    /**
     * @return string[]
     */
    public static function toolNames(string $packageId): array
    {
        return self::catalog()[$packageId]['tools'] ?? [];
    }

    /**
     * Paquets activés par défaut selon le type d'agent.
     *
     * @return string[]
     */
    public static function defaultForAgentType(string $type): array
    {
        $enabled = [self::PACKAGE_CORE];

        foreach (self::catalog() as $package) {
            if (in_array($type, $package['default_for_types'], true)) {
                $enabled[] = $package['id'];
            }
        }

        return array_values(array_unique($enabled));
    }

    /**
     * @return array<int, array{id: string, label: string, description: string, tools: string[]}>
     */
    public static function listForApi(): array
    {
        return array_values(array_map(
            fn (array $package): array => [
                'id' => $package['id'],
                'label' => $package['label'],
                'description' => $package['description'],
                'tools' => $package['tools'],
            ],
            self::catalog(),
        ));
    }
}
