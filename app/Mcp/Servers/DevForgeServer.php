<?php

namespace App\Mcp\Servers;

use App\Mcp\Tools\DevForge\ControlResource;
use App\Mcp\Tools\DevForge\FixApplicationHostPermissions;
use App\Mcp\Tools\DevForge\GetDeploymentLogs;
use App\Mcp\Tools\DevForge\UpdateApplicationGitBranch;
use App\Mcp\Tools\GetApplication;
use Laravel\Mcp\Server;
use Laravel\Mcp\Server\Attributes\Instructions;
use Laravel\Mcp\Server\Attributes\Name;
use Laravel\Mcp\Server\Attributes\Version;

#[Name('DevForge')]
#[Version('0.1.0')]
#[Instructions(<<<'MD'
DevForge MCP — repair-focused tools for Coolify applications (team-scoped Sanctum token).

Recommended workflow:
1. get_application — confirm UUID / branch / status.
2. get_deployment_logs — inspect recent failures (Permission denied, remote branch, build).
3. fix_application_host_permissions — when host Permission denied / tee errors.
4. update_application_git_branch — when remote branch is missing.
5. control_resource — redeploy (type=applications, action=deploy only).

Mutating tools require the token ability `write`. Read tools require `read`.
MD)]
class DevForgeServer extends Server
{
    protected array $tools = [
        GetApplication::class,
        GetDeploymentLogs::class,
        FixApplicationHostPermissions::class,
        UpdateApplicationGitBranch::class,
        ControlResource::class,
    ];

    protected array $resources = [];

    protected array $prompts = [];
}
