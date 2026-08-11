<?php

use App\Models\AiAgent;
use App\Models\AiAgentRun;
use App\Models\Team;
use App\Services\DevForge\Agent\AgentToolkit;
use App\Services\DevForge\Agent\Tool\AgentToolPackage;
use App\Services\DevForge\Core\CoreResourceAction;
use App\Services\DevForge\Core\CoreResourceCatalog;
use App\Services\DevForge\DeploymentData;
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
        catalog: app(CoreResourceCatalog::class),
        resourceAction: app(CoreResourceAction::class),
        deploymentData: app(DeploymentData::class),
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
        ->and($names)->toContain('list_tool_packages')
        ->and($names)->toContain('memory_read')
        ->and($names)->toContain('memory_write')
        ->and($names)->toContain('skill_list')
        ->and($names)->toContain('skill_load')
        ->and($names)->toContain('skill_write')
        ->and($names)->toContain('browser_fetch')
        ->and($names)->toContain('browser_smoke')
        ->and($names)->toContain('checkpoint_list')
        ->and($names)->toContain('checkpoint_rollback')
        ->and($names)->toContain('todo_read')
        ->and($names)->toContain('todo_write')
        ->and($names)->toContain('web_search');
});

it('exposes github write tools when github package is enabled', function () {
    $agent = AiAgent::factory()->create(['team_id' => $this->team->id, 'type' => 'github']);
    $toolkit = makeToolkit($this->team, $agent, $this->run);
    $names = collect($toolkit->definitions())->pluck('name');

    expect($names)->toContain('create_github_branch')
        ->and($names)->toContain('write_github_file')
        ->and($names)->toContain('create_github_pull_request')
        ->and($names)->toContain('merge_github_pull_request')
        ->and($names)->toContain('close_github_pull_request')
        ->and($names)->toContain('comment_github_pull_request');
});

it('hides github write tools in plan chat mode', function () {
    $agent = AiAgent::factory()->create(['team_id' => $this->team->id, 'type' => 'github']);
    $toolkit = new AgentToolkit(
        team: $this->team,
        run: $this->run,
        catalog: app(CoreResourceCatalog::class),
        resourceAction: app(CoreResourceAction::class),
        deploymentData: app(DeploymentData::class),
        agent: $agent,
        runContext: ['chat_mode' => 'plan'],
    );
    $names = collect($toolkit->definitions())->pluck('name');

    expect($names)->toContain('read_github_file')
        ->and($names)->not->toContain('write_github_file')
        ->and($names)->not->toContain('control_resource');
});

it('auto-enables github package for deployment and debug agent types', function () {
    foreach (['deployment', 'debug', 'devforge'] as $type) {
        $agent = AiAgent::factory()->create(['team_id' => $this->team->id, 'type' => $type]);
        $toolkit = makeToolkit($this->team, $agent, $this->run);
        $names = collect($toolkit->definitions())->pluck('name');

        expect($names)->toContain('read_github_file')
            ->and($names)->toContain('list_application_source')
            ->and($names)->toContain('read_application_source')
            ->and($names)->toContain('write_application_source');
    }
});

it('exposes application source tools in core package', function () {
    $agent = AiAgent::factory()->create(['team_id' => $this->team->id, 'type' => 'debug']);
    $toolkit = makeToolkit($this->team, $agent, $this->run);
    $names = collect($toolkit->definitions())->pluck('name');

    expect($names)->toContain('get_application_source_info')
        ->and($names)->toContain('list_application_source')
        ->and($names)->toContain('read_application_source')
        ->and($names)->toContain('write_application_source');
});

it('enables env var and spawn_task tools from the core package', function () {
    $agent = AiAgent::factory()->create(['team_id' => $this->team->id, 'type' => 'debug']);
    $toolkit = makeToolkit($this->team, $agent, $this->run);
    $names = collect($toolkit->definitions())->pluck('name');

    expect($names)->toContain('list_application_env_vars')
        ->and($names)->toContain('upsert_application_env_var')
        ->and($names)->toContain('update_application_git_branch')
        ->and($names)->toContain('get_application_runtime_settings')
        ->and($names)->toContain('update_application_runtime_settings')
        ->and($names)->toContain('fix_application_host_permissions')
        ->and($names)->toContain('fix_coolify_base_config_path');

    // spawn_task est conditionnel dans definitions() (canSpawnEphemeral), mais doit rester activable via PACKAGE_CORE.
    expect(AgentToolPackage::toolNames(AgentToolPackage::PACKAGE_CORE))->toContain('spawn_task')
        ->and(AgentToolPackage::toolNames(AgentToolPackage::PACKAGE_CORE))->toContain('update_application_git_branch')
        ->and(AgentToolPackage::toolNames(AgentToolPackage::PACKAGE_CORE))->toContain('update_application_runtime_settings')
        ->and(AgentToolPackage::toolNames(AgentToolPackage::PACKAGE_CORE))->toContain('fix_application_host_permissions')
        ->and(AgentToolPackage::toolNames(AgentToolPackage::PACKAGE_CORE))->toContain('fix_coolify_base_config_path');

    foreach (['list_application_env_vars', 'upsert_application_env_var', 'update_application_git_branch', 'update_application_runtime_settings', 'fix_application_host_permissions', 'fix_coolify_base_config_path', 'spawn_task'] as $toolName) {
        $result = $toolkit->execute($toolName, []);

        expect($result['error'] ?? '')->not->toContain('non activé');
    }
});

it('returns a clear error when write_application_source is missing commit_message', function () {
    $agent = AiAgent::factory()->create(['team_id' => $this->team->id, 'type' => 'debug']);
    $toolkit = makeToolkit($this->team, $agent, $this->run);

    $result = $toolkit->execute('write_application_source', [
        'path' => 'README.md',
        'content' => 'hello',
    ]);

    expect($result)->toHaveKey('error')
        ->and($result['error'])->toContain('commit_message');
});

it('requires diff preview approval for write_application_source in chat', function () {
    config()->set('devforge.agents_chat_source_write_preview', true);
    config()->set('devforge.agents_permission_mode', 'autonomous');

    $agent = AiAgent::factory()->create(['team_id' => $this->team->id, 'type' => 'debug']);
    $session = \App\Models\AiAgentSession::factory()->create(['agent_id' => $agent->id]);
    $run = AiAgentRun::factory()->create([
        'agent_id' => $agent->id,
        'trigger' => 'chat',
        'session_id' => $session->id,
    ]);
    $toolkit = makeToolkit($this->team, $agent, $run);

    $result = $toolkit->execute('write_application_source', [
        'path' => 'README.md',
        'content' => "# changed\n",
        'commit_message' => 'update readme',
    ]);

    expect($result['status'] ?? null)->toBe('ask')
        ->and($result['rule_id'] ?? null)->toBe('chat:source_write_preview')
        ->and($result)->toHaveKey('diff_preview')
        ->and($result['diff_preview']['path'] ?? null)->toBe('README.md');
});

it('rejects write_application_source for .env paths and hints upsert_application_env_var', function () {
    $agent = AiAgent::factory()->create(['team_id' => $this->team->id, 'type' => 'debug']);
    $toolkit = makeToolkit($this->team, $agent, $this->run);

    foreach (['.env', '.env.local', 'config/.env.production'] as $path) {
        $result = $toolkit->execute('write_application_source', [
            'path' => $path,
            'content' => 'PUPPETEER_SKIP_DOWNLOAD=true',
            'commit_message' => 'skip puppeteer',
        ]);

        expect($result)->toHaveKey('error')
            ->and($result['error'])->toContain('upsert_application_env_var')
            ->and($result['hint'] ?? null)->toBe('upsert_application_env_var');
    }
});

it('rejects cosmetic dummy env vars used to force redeploy', function () {
    $agent = AiAgent::factory()->create(['team_id' => $this->team->id, 'type' => 'debug']);
    $toolkit = makeToolkit($this->team, $agent, $this->run);

    $result = $toolkit->execute('upsert_application_env_var', [
        'key' => 'DUMMY_REDEPLOY_TRIGGER',
        'value' => '1',
    ]);

    expect($result)->toHaveKey('error')
        ->and($result['error'])->toContain('factice');
});

it('enables github package on demand and persists to agent metadata', function () {
    $agent = AiAgent::factory()->create(['team_id' => $this->team->id, 'type' => 'security']);
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

it('returns a clear error when read_application_source is missing path', function () {
    $agent = AiAgent::factory()->create(['team_id' => $this->team->id, 'type' => 'debug']);
    $toolkit = makeToolkit($this->team, $agent, $this->run);

    $result = $toolkit->execute('read_application_source', []);

    expect($result)->toHaveKey('error')
        ->and($result['error'])->toContain('path');
});

it('returns a clear error when get_resource_status is missing uuid', function () {
    $agent = AiAgent::factory()->create(['team_id' => $this->team->id, 'type' => 'debug']);
    $toolkit = makeToolkit($this->team, $agent, $this->run);

    $result = $toolkit->execute('enable_tool_package', [
        'package' => AgentToolPackage::PACKAGE_CORE,
        'reason' => 'test',
    ]);

    // PACKAGE_CORE is always enabled by default; accept already_enabled or a fresh enable.
    expect(($result['enabled'] ?? false) || ($result['already_enabled'] ?? false))->toBeTrue();

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
