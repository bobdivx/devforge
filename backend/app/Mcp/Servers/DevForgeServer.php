<?php

namespace App\Mcp\Servers;

use App\Services\DevForge\Mcp\DevForgeMcpToolRegistrar;
use Laravel\Mcp\Server;
use Laravel\Mcp\Server\Attributes\Instructions;
use Laravel\Mcp\Server\Attributes\Name;
use Laravel\Mcp\Server\Attributes\Version;

#[Name('DevForge')]
#[Version('0.2.0')]
#[Instructions(<<<'MD'
DevForge MCP — full team-scoped surface for DevForge/DevForge (Sanctum token).

Includes:
1. DevForge read tools — infrastructure overview, servers, projects, applications, databases, services.
2. AgentToolkit core — deployments, control_resource (start/stop/restart/deploy), SSH/docker, source, env, runtime, repair.
3. GitHub package — apps, repos, branches, PRs, workflows, commits (read + write).

Mutating tools require token ability `write`. Read tools require `read`.
MD)]
class DevForgeServer extends Server
{
    public int $maxPaginationLength = 100;

    public int $defaultPaginationLength = 100;

    protected array $tools = [];

    protected array $resources = [];

    protected array $prompts = [];

    protected function boot(): void
    {
        $this->tools = DevForgeMcpToolRegistrar::allTools();
    }
}
