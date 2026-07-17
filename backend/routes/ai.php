<?php

use App\Mcp\Servers\CoolifyServer;
use App\Mcp\Servers\DevForgeServer;
use Laravel\Mcp\Facades\Mcp;

Mcp::web('/mcp', CoolifyServer::class)
    ->middleware(['mcp.enabled', 'auth:sanctum', 'api.token.team']);

Mcp::web('/mcp/devforge', DevForgeServer::class)
    ->middleware(['mcp.enabled', 'devforge.mcp.enabled', 'auth:sanctum', 'api.token.team']);
