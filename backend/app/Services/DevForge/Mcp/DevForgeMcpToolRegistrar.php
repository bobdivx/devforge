<?php

namespace App\Services\DevForge\Mcp;

use App\Mcp\Tools\DevForge\ToolkitProxyTool;
use App\Mcp\Tools\GetApplication;
use App\Mcp\Tools\GetDatabase;
use App\Mcp\Tools\GetInfrastructureOverview;
use App\Mcp\Tools\GetServer;
use App\Mcp\Tools\GetService;
use App\Mcp\Tools\ListApplications;
use App\Mcp\Tools\ListDatabases;
use App\Mcp\Tools\ListProjects;
use App\Mcp\Tools\ListServers;
use App\Mcp\Tools\ListServices;
use App\Models\Team;
use App\Services\DevForge\Agent\AgentToolkit;
use App\Services\DevForge\Core\CoreResourceAction;
use App\Services\DevForge\Core\CoreResourceCatalog;
use App\Services\DevForge\DeploymentData;
use Laravel\Mcp\Server\Tool;

class DevForgeMcpToolRegistrar
{
    /**
     * Outils liés à un agent/session — exclus du MCP (pas de contexte run UI).
     *
     * @var list<string>
     */
    public const EXCLUDED_TOOLKIT_TOOLS = [
        'enable_tool_package',
        'list_tool_packages',
        'request_tool',
        'request_api_key',
        'request_user_input',
        'memory_read',
        'memory_write',
        'todo_read',
        'todo_write',
        'mission_list',
        'mission_show',
        'mission_create',
        'mission_claim',
        'mission_update',
        'delegate_task',
        'spawn_task',
        'yield_wait',
        'propose_plan',
        'send_notification',
    ];

    /**
     * @return list<class-string<Tool>>
     */
    public static function coolifyReadTools(): array
    {
        return [
            GetInfrastructureOverview::class,
            ListServers::class,
            GetServer::class,
            ListProjects::class,
            ListApplications::class,
            GetApplication::class,
            ListDatabases::class,
            GetDatabase::class,
            ListServices::class,
            GetService::class,
        ];
    }

    /**
     * @return list<Tool>
     */
    public static function toolkitProxyTools(): array
    {
        $definitions = self::toolkitDefinitions();
        $tools = [];

        foreach ($definitions as $definition) {
            $name = (string) ($definition['name'] ?? '');
            if ($name === '' || in_array($name, self::EXCLUDED_TOOLKIT_TOOLS, true)) {
                continue;
            }

            $parameters = is_array($definition['parameters'] ?? null)
                ? $definition['parameters']
                : ['type' => 'object', 'properties' => []];

            $tools[] = new ToolkitProxyTool(
                name: $name,
                description: (string) ($definition['description'] ?? $name),
                parameters: $parameters,
            );
        }

        return $tools;
    }

    /**
     * @return list<Tool|class-string<Tool>>
     */
    public static function allTools(): array
    {
        return [
            ...self::coolifyReadTools(),
            ...self::toolkitProxyTools(),
        ];
    }

    /**
     * @return list<array{name: string, description: string, parameters: array<mixed>}>
     */
    private static function toolkitDefinitions(): array
    {
        $team = new Team(['name' => 'mcp-definitions']);
        $run = new McpEphemeralRun([
            'status' => 'running',
            'trigger' => 'mcp',
            'logs' => '',
            'actions_taken' => [],
            'metadata' => ['source' => 'mcp'],
        ]);

        $toolkit = new AgentToolkit(
            team: $team,
            run: $run,
            catalog: app(CoreResourceCatalog::class),
            resourceAction: app(CoreResourceAction::class),
            deploymentData: app(DeploymentData::class),
            agent: null,
            runContext: ['chat_mode' => 'build', 'source' => 'mcp'],
            extraToolPackages: [\App\Services\DevForge\Agent\Tool\AgentToolPackage::PACKAGE_GITHUB],
        );

        return $toolkit->definitions();
    }
}
