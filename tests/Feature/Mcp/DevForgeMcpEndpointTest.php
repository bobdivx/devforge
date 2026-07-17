<?php

use App\Models\AiAgent;
use App\Models\AiAgentRun;
use App\Models\InstanceSettings;
use App\Models\Team;
use App\Models\User;
use App\Services\DevForge\Agent\AgentRepairHarness;
use App\Services\DevForge\Agent\AgentToolkit;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Once;

uses(RefreshDatabase::class);

beforeEach(function () {
    InstanceSettings::query()->where('id', 0)->delete();
    InstanceSettings::query()->delete();
    $settings = new InstanceSettings(['is_mcp_server_enabled' => true]);
    $settings->id = 0;
    $settings->save();

    config(['devforge.mcp_enabled' => true]);

    $this->team = Team::factory()->create();
    $this->user = User::factory()->create();
    $this->team->members()->attach($this->user->id, ['role' => 'owner']);
    session(['currentTeam' => $this->team]);
});

function mcpDevforgePost(array $payload, ?string $token = null)
{
    $headers = [
        'Content-Type' => 'application/json',
        'Accept' => 'application/json, text/event-stream',
    ];
    if ($token) {
        $headers['Authorization'] = 'Bearer '.$token;
    }

    return test()->withHeaders($headers)->postJson('/mcp/devforge', $payload);
}

function mcpDevforgeListTools(string $token)
{
    return mcpDevforgePost([
        'jsonrpc' => '2.0',
        'id' => 1,
        'method' => 'tools/list',
        'params' => (object) [],
    ], $token);
}

function mcpDevforgeCallTool(string $token, string $name, array $arguments = [])
{
    return mcpDevforgePost([
        'jsonrpc' => '2.0',
        'id' => 1,
        'method' => 'tools/call',
        'params' => [
            'name' => $name,
            'arguments' => (object) $arguments,
        ],
    ], $token);
}

test('DevForge MCP returns 404 when DEVFORGE_MCP_ENABLED is false', function () {
    config(['devforge.mcp_enabled' => false]);

    $token = $this->user->createToken('mcp-write', ['read', 'write'])->plainTextToken;
    $response = mcpDevforgeListTools($token);
    $response->assertStatus(404);
});

test('DevForge MCP returns 404 when instance MCP setting is disabled', function () {
    InstanceSettings::query()->where('id', 0)->update(['is_mcp_server_enabled' => false]);
    Once::flush();

    $token = $this->user->createToken('mcp-write', ['read', 'write'])->plainTextToken;
    $response = mcpDevforgeListTools($token);
    $response->assertStatus(404);
});

test('DevForge MCP lists repair tools for an authenticated token', function () {
    $token = $this->user->createToken('mcp-write', ['read', 'write'])->plainTextToken;

    $response = mcpDevforgeListTools($token);
    $response->assertOk();

    $toolNames = collect($response->json('result.tools'))->pluck('name')->all();
    expect($toolNames)->toContain(
        'get_application',
        'get_deployment_logs',
        'fix_application_host_permissions',
        'update_application_git_branch',
        'control_resource',
    );
});

test('DevForge MCP rejects mutating tools without write ability', function () {
    $token = $this->user->createToken('mcp-read', ['read'])->plainTextToken;

    $response = mcpDevforgeCallTool($token, 'fix_application_host_permissions', [
        'application_uuid' => 'app-does-not-exist',
    ]);
    $response->assertOk();

    expect($response->json('result.isError'))->toBeTrue();
    expect($response->json('result.content.0.text'))->toContain('Missing required permissions');
});

test('DevForge MCP allows get_deployment_logs with read ability', function () {
    $token = $this->user->createToken('mcp-read', ['read'])->plainTextToken;

    $response = mcpDevforgeCallTool($token, 'get_deployment_logs', [
        'application_uuid' => 'app-missing',
        'limit' => 1,
    ]);
    $response->assertOk();

    expect($response->json('result.isError'))->toBeFalse();
});

test('DevForge MCP control_resource rejects non-deploy actions', function () {
    $token = $this->user->createToken('mcp-write', ['read', 'write'])->plainTextToken;

    $response = mcpDevforgeCallTool($token, 'control_resource', [
        'uuid' => 'app-missing',
        'type' => 'applications',
        'action' => 'stop',
    ]);
    $response->assertOk();

    expect($response->json('result.isError'))->toBeTrue();
    expect($response->json('result.content.0.text'))->toContain('only supports');
});
