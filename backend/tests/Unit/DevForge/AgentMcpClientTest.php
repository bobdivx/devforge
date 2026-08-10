<?php

use App\Models\AiAgent;
use App\Services\DevForge\Agent\AgentChatMode;
use App\Services\DevForge\Agent\AgentMcpClientRegistry;
use App\Services\DevForge\Agent\Tool\AgentPermissionEngine;
use App\Services\DevForge\Agent\Tool\AgentToolPackage;
use App\Services\DevForge\Agent\Tool\AgentToolkitSession;
use Illuminate\Support\Facades\Http;

beforeEach(function () {
    config([
        'devforge.agents_mcp_client_enabled' => false,
        'devforge.agents_mcp_client_timeout' => 10,
        'devforge.agents_mcp_servers' => [],
    ]);
});

it('reports disabled and returns empty tools when mcp client is off', function () {
    $registry = new AgentMcpClientRegistry;

    expect($registry->enabled())->toBeFalse()
        ->and($registry->listServers())->toBe([])
        ->and($registry->toolDefinitions())->toBe([])
        ->and($registry->callEncodedTool('mcp__docs__search', ['q' => 'x']))
        ->toHaveKey('error');
});

it('encodes and decodes mcp tool names', function () {
    $registry = new AgentMcpClientRegistry;

    $encoded = $registry->encodeToolName('Docs API', 'search.docs');

    expect($encoded)->toBe('mcp__docs-api__search.docs')
        ->and($registry->decodeToolName($encoded))->toBe([
            'server' => 'docs-api',
            'tool' => 'search.docs',
        ])
        ->and($registry->decodeToolName('not_mcp'))->toBeNull()
        ->and($registry->isMcpTool($encoded))->toBeTrue()
        ->and($registry->isMcpTool('mcp_list_servers'))->toBeTrue();
});

it('lists and calls remote tools when enabled', function () {
    config([
        'devforge.agents_mcp_client_enabled' => true,
        'devforge.agents_mcp_servers' => [
            [
                'id' => 'docs',
                'url' => 'https://mcp.example.test/mcp',
                'label' => 'Docs',
            ],
        ],
    ]);

    Http::fake([
        'https://mcp.example.test/mcp' => Http::sequence()
            ->push(['jsonrpc' => '2.0', 'id' => 1, 'result' => [
                'protocolVersion' => '2024-11-05',
                'capabilities' => [],
                'serverInfo' => ['name' => 'docs', 'version' => '1'],
            ]])
            ->push(['jsonrpc' => '2.0', 'result' => true]) // notifications/initialized
            ->push(['jsonrpc' => '2.0', 'id' => 2, 'result' => [
                'tools' => [
                    [
                        'name' => 'search',
                        'description' => 'Search docs',
                        'inputSchema' => [
                            'type' => 'object',
                            'properties' => ['q' => ['type' => 'string']],
                            'required' => ['q'],
                        ],
                    ],
                ],
            ]])
            ->push(['jsonrpc' => '2.0', 'id' => 3, 'result' => [
                'content' => [
                    ['type' => 'text', 'text' => '{"hits":["guide"]}'],
                ],
            ]]),
    ]);

    $registry = new AgentMcpClientRegistry;

    expect($registry->listServers())->toHaveCount(1)
        ->and($registry->listServers()[0]['id'])->toBe('docs');

    $defs = $registry->toolDefinitions();
    expect($defs)->toHaveCount(1)
        ->and($defs[0]['name'])->toBe('mcp__docs__search')
        ->and($defs[0]['mcp_tool'])->toBe('search');

    $call = $registry->callEncodedTool('mcp__docs__search', ['q' => 'guide']);
    expect($call['ok'] ?? false)->toBeTrue()
        ->and($call['result'])->toBe(['hits' => ['guide']]);
});

it('merges agent metadata mcp_servers over config', function () {
    config([
        'devforge.agents_mcp_client_enabled' => true,
        'devforge.agents_mcp_servers' => [
            ['id' => 'global', 'url' => 'https://global.example/mcp'],
        ],
    ]);

    Http::fake([
        'https://agent.example/mcp' => Http::response([
            'jsonrpc' => '2.0',
            'id' => 1,
            'result' => ['tools' => [['name' => 'ping', 'description' => 'Ping']]],
        ]),
        '*' => Http::response([
            'jsonrpc' => '2.0',
            'id' => 1,
            'result' => ['tools' => []],
        ]),
    ]);

    $agent = new AiAgent;
    $agent->forceFill([
        'name' => 'Test',
        'metadata' => [
            'mcp_servers' => [
                ['id' => 'agent-docs', 'url' => 'https://agent.example/mcp', 'label' => 'Agent Docs'],
            ],
        ],
    ]);

    $registry = new AgentMcpClientRegistry;
    $servers = $registry->listServers($agent);

    expect(collect($servers)->pluck('id')->all())
        ->toContain('global', 'agent-docs');
});

it('permission engine denies mcp tools when client disabled', function () {
    config(['devforge.agents_mcp_client_enabled' => false]);
    $agent = new AiAgent;
    $agent->forceFill(['name' => 'Test', 'metadata' => []]);

    $decision = (new AgentPermissionEngine)->decide($agent, 'mcp__docs__search', ['q' => 'x']);

    expect($decision['decision'])->toBe(AgentPermissionEngine::DECISION_DENY)
        ->and($decision['rule_id'])->toBe('mcp:disabled');
});

it('session enables mcp tools only when client is on', function () {
    $agent = new AiAgent;
    $agent->forceFill(['name' => 'Test', 'type' => 'general', 'metadata' => []]);
    $session = new AgentToolkitSession($agent);

    expect($session->isToolEnabled('mcp_list_servers'))->toBeFalse()
        ->and($session->isToolEnabled('mcp__docs__search'))->toBeFalse();

    config(['devforge.agents_mcp_client_enabled' => true]);

    expect($session->isToolEnabled('mcp_list_servers'))->toBeTrue()
        ->and($session->isToolEnabled('mcp__docs__search'))->toBeTrue()
        ->and(in_array('mcp_list_servers', AgentToolPackage::META_TOOLS, true))->toBeTrue();
});

it('blocks remote mcp tools in plan chat mode', function () {
    expect(AgentChatMode::isToolAllowed('mcp__docs__search', AgentChatMode::PLAN))->toBeFalse()
        ->and(AgentChatMode::isToolAllowed('mcp_list_servers', AgentChatMode::PLAN))->toBeTrue()
        ->and(AgentChatMode::isToolAllowed('mcp__docs__search', AgentChatMode::BUILD))->toBeTrue();
});
