<?php

use App\Mcp\Tools\DevForge\ToolkitProxyTool;
use App\Mcp\Tools\GetApplication;
use App\Services\DevForge\Mcp\DevForgeMcpToolRegistrar;

test('DevForge MCP registrar exposes Coolify reads plus toolkit proxies', function () {
    $tools = DevForgeMcpToolRegistrar::allTools();

    expect($tools)->toContain(GetApplication::class);

    $proxyNames = collect($tools)
        ->filter(fn ($tool) => $tool instanceof ToolkitProxyTool)
        ->map(fn (ToolkitProxyTool $tool) => $tool->name())
        ->values()
        ->all();

    expect($proxyNames)->toContain(
        'list_resources',
        'control_resource',
        'get_deployment_logs',
        'exec_command',
        'list_github_apps',
        'sync_application_proxy_labels',
    );

    foreach (DevForgeMcpToolRegistrar::EXCLUDED_TOOLKIT_TOOLS as $excluded) {
        expect($proxyNames)->not->toContain($excluded);
    }

    expect(count($tools))->toBeGreaterThan(40);
});
