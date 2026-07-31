<?php

use App\Models\Server;
use App\Models\Team;
use App\Models\User;
use App\Services\DevForge\Github\GithubRunnerInventory;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

beforeEach(function () {
    config()->set('devforge.enabled', true);

    $this->user = User::factory()->create();
    $this->team = $this->user->teams()->firstOrFail();
    $this->session = ['currentTeam' => $this->team];
    $this->server = Server::factory()->create([
        'team_id' => $this->team->id,
        'name' => 'zimacube',
    ]);
});

it('lists github runners for the current team', function () {
    $fake = Mockery::mock(GithubRunnerInventory::class);
    $fake->shouldReceive('listForTeam')
        ->once()
        ->with(Mockery::on(fn (Team $team): bool => $team->id === $this->team->id))
        ->andReturn([
            [
                'id' => $this->server->uuid.':github-runner-client',
                'name' => 'github-runner-client',
                'container_id' => 'abc123',
                'image' => 'ghcr.io/bobdivx/popcorn-github-runner-client:latest',
                'state' => 'running',
                'status' => 'Up 2 hours',
                'created' => '2026-07-31 10:00:00',
                'server_uuid' => $this->server->uuid,
                'server_name' => 'zimacube',
                'repo_url' => null,
                'runner_name' => 'github-runner-client',
            ],
        ]);

    $this->app->instance(GithubRunnerInventory::class, $fake);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson('/api/devforge/v1/github/runners')
        ->assertSuccessful()
        ->assertJsonPath('data.0.name', 'github-runner-client')
        ->assertJsonPath('data.0.server_uuid', $this->server->uuid);
});

it('returns runner logs', function () {
    $fake = Mockery::mock(GithubRunnerInventory::class);
    $fake->shouldReceive('logs')
        ->once()
        ->with(
            Mockery::type(Team::class),
            $this->server->uuid,
            'github-runner-client',
            100,
        )
        ->andReturn([
            'available' => true,
            'reason' => null,
            'message' => null,
            'container' => 'github-runner-client',
            'container_status' => 'running',
            'line_count' => 100,
            'items' => [
                ['cursor' => 1, 'message' => '√ Connected to GitHub'],
            ],
        ]);

    $this->app->instance(GithubRunnerInventory::class, $fake);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson('/api/devforge/v1/github/runners/'.$this->server->uuid.'/github-runner-client/logs?lines=100')
        ->assertSuccessful()
        ->assertJsonPath('data.available', true)
        ->assertJsonPath('data.items.0.message', '√ Connected to GitHub');
});

it('restarts a github runner', function () {
    $fake = Mockery::mock(GithubRunnerInventory::class);
    $fake->shouldReceive('action')
        ->once()
        ->with(
            Mockery::type(Team::class),
            $this->server->uuid,
            'github-runner-server',
            'restart',
        )
        ->andReturn([
            'ok' => true,
            'action' => 'restart',
            'message' => 'Runner redémarré.',
            'runner' => [
                'id' => $this->server->uuid.':github-runner-server',
                'name' => 'github-runner-server',
                'state' => 'running',
                'server_uuid' => $this->server->uuid,
                'server_name' => 'zimacube',
            ],
        ]);

    $this->app->instance(GithubRunnerInventory::class, $fake);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson('/api/devforge/v1/github/runners/'.$this->server->uuid.'/github-runner-server/restart')
        ->assertSuccessful()
        ->assertJsonPath('data.ok', true)
        ->assertJsonPath('message', 'Runner redémarré.');
});

it('creates a github runner', function () {
    $fake = Mockery::mock(GithubRunnerInventory::class);
    $fake->shouldReceive('create')
        ->once()
        ->with(
            Mockery::type(Team::class),
            Mockery::on(fn (array $input): bool => ($input['owner'] ?? null) === 'bobdivx'
                && ($input['repo'] ?? null) === 'popcorn-client'
                && ($input['server_uuid'] ?? null) === $this->server->uuid),
        )
        ->andReturn([
            'message' => 'Runner créé et démarré.',
            'runner' => [
                'id' => $this->server->uuid.':github-runner-popcorn-client',
                'name' => 'github-runner-popcorn-client',
                'state' => 'running',
                'server_uuid' => $this->server->uuid,
                'github_status' => null,
            ],
        ]);

    $this->app->instance(GithubRunnerInventory::class, $fake);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson('/api/devforge/v1/github/runners', [
            'github_app_uuid' => 'app-uuid-test123',
            'owner' => 'bobdivx',
            'repo' => 'popcorn-client',
            'server_uuid' => $this->server->uuid,
            'runner_name' => 'casaos-runner-popcorn-client',
        ])
        ->assertCreated()
        ->assertJsonPath('message', 'Runner créé et démarré.')
        ->assertJsonPath('data.name', 'github-runner-popcorn-client');
});
