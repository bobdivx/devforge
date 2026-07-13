<?php

use App\Models\Server;
use App\Models\Team;
use App\Services\DevForge\Agent\AgentResourceStatusResolver;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

it('resolves server status from settings without calling the status method', function () {
    $team = Team::factory()->create();
    $server = Server::factory()->create(['team_id' => $team->id]);
    $server->settings()->update([
        'is_reachable' => true,
        'is_usable' => false,
    ]);
    $server->load('settings');

    $status = AgentResourceStatusResolver::resolve($server, 'servers');

    expect($status)->toBe([
        'reachable' => true,
        'usable' => false,
        'validating' => false,
    ]);
});

it('resolves application status from raw attributes', function () {
    $application = new \App\Models\Application([
        'uuid' => 'app-uuid',
        'name' => 'Demo',
        'status' => 'running',
    ]);

    expect(AgentResourceStatusResolver::resolve($application, 'applications'))->toBe('running');
});
