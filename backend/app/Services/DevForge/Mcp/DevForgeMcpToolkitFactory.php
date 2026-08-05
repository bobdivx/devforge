<?php

namespace App\Services\DevForge\Mcp;

use App\Models\Team;
use App\Services\DevForge\Agent\AgentToolkit;
use App\Services\DevForge\Agent\Tool\AgentToolPackage;
use App\Services\DevForge\Core\CoreResourceAction;
use App\Services\DevForge\Core\CoreResourceCatalog;
use App\Services\DevForge\DeploymentData;

class DevForgeMcpToolkitFactory
{
    public function make(Team $team): AgentToolkit
    {
        $run = new McpEphemeralRun([
            'status' => 'running',
            'trigger' => 'mcp',
            'logs' => '',
            'actions_taken' => [],
            'metadata' => ['source' => 'mcp'],
        ]);

        return new AgentToolkit(
            team: $team,
            run: $run,
            catalog: app(CoreResourceCatalog::class),
            resourceAction: app(CoreResourceAction::class),
            deploymentData: app(DeploymentData::class),
            agent: null,
            assignedResourceUuid: null,
            runContext: [
                'chat_mode' => 'build',
                'source' => 'mcp',
            ],
            extraToolPackages: [AgentToolPackage::PACKAGE_GITHUB],
        );
    }
}
