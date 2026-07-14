<?php

use App\Models\AiAgent;
use App\Models\AiAgentRun;
use App\Models\Team;
use App\Services\DevForge\Agent\AgentToolkit;
use App\Services\DevForge\Agent\Tool\AgentToolPackage;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

beforeEach(function () {
    $this->team = Team::factory()->create();
    $this->run = AiAgentRun::factory()->create();
});

function makeToolkit(Team $team, AiAgent $agent, AiAgentRun $run): AgentToolkit
{
    return new AgentToolkit(
        team: $team,
        run: $run,
        catalog: app(\App\Services\DevForge\Core\CoreResourceCatalog::class),
        resourceAction: app(\App\Services\DevForge\Core\CoreResourceAction::class),
        deploymentData: app(\App\Services\DevForge\DeploymentData::class),
        agent: $agent,
    );
}

it('always exposes meta tools for self-provisioning', function () {
    $agent = AiAgent::factory()->create(['team_id' => $this->team->id, 'type' => 'debug']);
    $toolkit = makeToolkit($this->team, $agent, $this->run);
    $names = collect($toolkit->definitions())->pluck('name');

    expect($names)->toContain('enable_tool_package')
        ->and($names)->toContain('install_tool')
        ->and($names)->toContain('request_tool')
        ->and($names)->toContain('list_tool_packages');
});

it('auto-enables github package for github agent type', function () {
    $agent = AiAgent::factory()->create(['team_id' => $this->team->id, 'type' => 'github']);
    $toolkit = makeToolkit($this->team, $agent, $this->run);
    $names = collect($toolkit->definitions())->pluck('name');

    expect($names)->toContain('list_github_repos')
        ->and($names)->toContain('read_github_file');
});

it('enables github package on demand and persists to agent metadata', function () {
    $agent = AiAgent::factory()->create(['team_id' => $this->team->id, 'type' => 'debug']);
    $toolkit = makeToolkit($this->team, $agent, $this->run);

    $before = collect($toolkit->definitions())->pluck('name');
    expect($before)->not->toContain('list_github_repos');

    $result = $toolkit->execute('enable_tool_package', [
        'package' => AgentToolPackage::PACKAGE_GITHUB,
        'reason' => 'Besoin de lire les fichiers source',
    ]);

    expect($result['enabled'] ?? false)->toBeTrue();

    $after = collect($toolkit->definitions())->pluck('name');
    expect($after)->toContain('read_github_file');

    $agent->refresh();
    expect($agent->metadata['tool_packages']['enabled'] ?? [])->toContain(AgentToolPackage::PACKAGE_GITHUB);
});

it('registers custom tools via request_tool', function () {
    $agent = AiAgent::factory()->create(['team_id' => $this->team->id]);
    $toolkit = makeToolkit($this->team, $agent, $this->run);

    $result = $toolkit->execute('request_tool', [
        'name' => 'show_uptime',
        'description' => 'Affiche uptime du serveur',
        'command_template' => 'uptime',
        'parameters' => '{"type":"object","properties":{"server_uuid":{"type":"string"}},"required":["server_uuid"]}',
    ]);

    expect($result['registered'] ?? false)->toBeTrue();

    $names = collect($toolkit->definitions())->pluck('name');
    expect($names)->toContain('show_uptime');
});

it('returns a clear error when get_resource_status is missing uuid', function () {
    $agent = AiAgent::factory()->create(['team_id' => $this->team->id, 'type' => 'debug']);
    $toolkit = makeToolkit($this->team, $agent, $this->run);

    $result = $toolkit->execute('enable_tool_package', [
        'package' => AgentToolPackage::PACKAGE_CORE,
        'reason' => 'test',
    ]);

    expect($result['enabled'] ?? false)->toBeTrue();

    $status = $toolkit->execute('get_resource_status', []);

    expect($status)->toHaveKey('error')
        ->and($status['error'])->toContain('uuid');
});

it('exposes github PR and Actions tools when github package is enabled', function () {
    $agent = AiAgent::factory()->create(['team_id' => $this->team->id, 'type' => 'github']);
    $toolkit = makeToolkit($this->team, $agent, $this->run);
    $names = collect($toolkit->definitions())->pluck('name');

    expect($names)->toContain('list_github_pull_requests')
        ->and($names)->toContain('list_github_workflow_runs')
        ->and($names)->toContain('list_github_commits');
});
