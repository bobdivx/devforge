<?php

namespace App\Services\DevForge\Agent\Tool;

/**
 * Classification d'outils agent — porté depuis forge-tool-contract.ts (Forge).
 */
class AgentToolClassification
{
    public function __construct(
        public readonly bool $isReadOnly = false,
        public readonly bool $isDestructive = true,
        public readonly bool $isConcurrencySafe = false,
        public readonly string $runtimeProfile = 'worker',
    ) {}

    /**
     * @param  array<string, mixed>|null  $raw
     */
    public static function resolve(?array $raw = null): self
    {
        $raw ??= [];
        $isReadOnly = ($raw['isReadOnly'] ?? false) === true;
        $isDestructive = ($raw['isDestructive'] ?? null) === false ? false : ! $isReadOnly;
        $isConcurrencySafe = ($raw['isConcurrencySafe'] ?? false) === true;
        $runtimeProfile = is_string($raw['runtimeProfile'] ?? null) ? $raw['runtimeProfile'] : 'worker';

        return new self(
            isReadOnly: $isReadOnly,
            isDestructive: $isDestructive,
            isConcurrencySafe: $isConcurrencySafe,
            runtimeProfile: $runtimeProfile,
        );
    }

    /** @return array<string, AgentToolClassification> */
    public static function builtinMap(): array
    {
        $readOnly = ['isReadOnly' => true, 'isDestructive' => false, 'isConcurrencySafe' => true, 'runtimeProfile' => 'both'];
        $neutral = ['isReadOnly' => false, 'isDestructive' => false, 'runtimeProfile' => 'worker'];
        $destructive = ['isReadOnly' => false, 'isDestructive' => true, 'runtimeProfile' => 'worker'];

        $definitions = [
            'list_resources' => $readOnly,
            'get_resource_status' => $readOnly,
            'get_deployment_logs' => $readOnly,
            'get_application_source_info' => $readOnly,
            'list_application_source' => $readOnly,
            'read_application_source' => $readOnly,
            'write_application_source' => $destructive,
            'get_server_metrics' => $readOnly,
            'send_notification' => $neutral,
            'control_resource' => $destructive,
            'exec_command' => $destructive,
            'read_remote_file' => $readOnly,
            'list_remote_dir' => $readOnly,
            'search_remote_files' => $readOnly,
            'docker_logs' => $readOnly,
            'http_request' => $neutral,
            'write_remote_file' => $destructive,
            'delegate_task' => ['isReadOnly' => false, 'isDestructive' => false, 'runtimeProfile' => 'coordinator'],
            'enable_tool_package' => $neutral,
            'list_tool_packages' => $readOnly,
            'install_tool' => $destructive,
            'request_tool' => $neutral,
            'list_github_apps' => $readOnly,
            'list_github_repos' => $readOnly,
            'list_github_branches' => $readOnly,
            'read_github_file' => $readOnly,
            'list_github_dir' => $readOnly,
            'get_application_git_info' => $readOnly,
            'list_github_pull_requests' => $readOnly,
            'get_github_pull_request' => $readOnly,
            'list_github_workflow_runs' => $readOnly,
            'get_github_workflow_run' => $readOnly,
            'list_github_commits' => $readOnly,
        ];

        $map = [];
        foreach ($definitions as $name => $classification) {
            $map[$name] = self::resolve($classification);
        }

        return $map;
    }

    public static function forTool(string $toolName): self
    {
        return self::builtinMap()[$toolName] ?? self::resolve();
    }
}
