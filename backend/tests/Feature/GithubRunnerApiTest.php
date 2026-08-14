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

it('returns an empty list when runner inventory listing fails', function () {
    $fake = Mockery::mock(GithubRunnerInventory::class);
    $fake->shouldReceive('listForTeam')
        ->once()
        ->andThrow(new RuntimeException('ssh timeout'));

    $this->app->instance(GithubRunnerInventory::class, $fake);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson('/api/devforge/v1/github/runners')
        ->assertSuccessful()
        ->assertJsonPath('data', [])
        ->assertJsonPath('message', 'Impossible de lister les runners GitHub pour le moment.');
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

it('returns a runner detail payload', function () {
    $fake = Mockery::mock(GithubRunnerInventory::class);
    $fake->shouldReceive('show')
        ->once()
        ->with(
            Mockery::type(Team::class),
            $this->server->uuid,
            'github-runner-client',
        )
        ->andReturn([
            'id' => $this->server->uuid.':github-runner-client',
            'name' => 'github-runner-client',
            'state' => 'running',
            'server_uuid' => $this->server->uuid,
            'runner_name' => 'casaos-runner-popcorn-client',
            'repo_url' => 'https://github.com/bobdivx/popcorn-client',
            'github_status' => 'online',
            'environment' => [
                ['key' => 'REPO_URL', 'value' => 'https://github.com/bobdivx/popcorn-client'],
                ['key' => 'ACCESS_TOKEN', 'value' => '••••••••'],
            ],
        ]);

    $this->app->instance(GithubRunnerInventory::class, $fake);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson('/api/devforge/v1/github/runners/'.$this->server->uuid.'/github-runner-client')
        ->assertSuccessful()
        ->assertJsonPath('data.name', 'github-runner-client')
        ->assertJsonPath('data.github_status', 'online')
        ->assertJsonPath('data.environment.1.value', '••••••••');
});

it('returns json 404 when runner detail is missing', function () {
    $fake = Mockery::mock(GithubRunnerInventory::class);
    $fake->shouldReceive('show')
        ->once()
        ->andThrow((new Illuminate\Database\Eloquent\ModelNotFoundException)->setModel('GithubRunner', ['missing']));

    $this->app->instance(GithubRunnerInventory::class, $fake);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson('/api/devforge/v1/github/runners/'.$this->server->uuid.'/missing-runner')
        ->assertNotFound()
        ->assertJsonPath('message', 'Runner introuvable.');
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

it('creates a github runner with a personal access token', function () {
    $fake = Mockery::mock(GithubRunnerInventory::class);
    $fake->shouldReceive('create')
        ->once()
        ->with(
            Mockery::type(Team::class),
            Mockery::on(fn (array $input): bool => ($input['auth_mode'] ?? null) === 'pat'
                && ($input['access_token'] ?? null) === 'ghp_testtoken'
                && ($input['owner'] ?? null) === 'bobdivx'),
        )
        ->andReturn([
            'message' => 'Runner créé et démarré.',
            'runner' => [
                'id' => $this->server->uuid.':github-runner-client',
                'name' => 'github-runner-client',
                'state' => 'running',
                'server_uuid' => $this->server->uuid,
            ],
        ]);

    $this->app->instance(GithubRunnerInventory::class, $fake);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson('/api/devforge/v1/github/runners', [
            'auth_mode' => 'pat',
            'access_token' => 'ghp_testtoken',
            'owner' => 'bobdivx',
            'repo' => 'popcorn-client',
            'server_uuid' => $this->server->uuid,
            'runner_name' => 'casaos-runner-popcorn-client',
            'container_name' => 'github-runner-client',
        ])
        ->assertCreated()
        ->assertJsonPath('data.name', 'github-runner-client');
});

it('creates a github runner using a saved pat on the github app', function () {
    $fake = Mockery::mock(GithubRunnerInventory::class);
    $fake->shouldReceive('create')
        ->once()
        ->with(
            Mockery::type(Team::class),
            Mockery::on(fn (array $input): bool => ($input['auth_mode'] ?? null) === 'pat'
                && ($input['use_saved_pat'] ?? null) === true
                && ($input['github_app_uuid'] ?? null) === 'app-uuid-saved-pat'
                && ! array_key_exists('access_token', $input)),
        )
        ->andReturn([
            'message' => 'Runner créé et démarré.',
            'runner' => [
                'id' => $this->server->uuid.':github-runner-client',
                'name' => 'github-runner-client',
                'state' => 'running',
                'server_uuid' => $this->server->uuid,
            ],
        ]);

    $this->app->instance(GithubRunnerInventory::class, $fake);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson('/api/devforge/v1/github/runners', [
            'auth_mode' => 'pat',
            'use_saved_pat' => true,
            'github_app_uuid' => 'app-uuid-saved-pat',
            'owner' => 'bobdivx',
            'repo' => 'popcorn-client',
            'server_uuid' => $this->server->uuid,
            'runner_name' => 'casaos-runner-popcorn-client',
            'container_name' => 'github-runner-client',
        ])
        ->assertCreated()
        ->assertJsonPath('data.name', 'github-runner-client');
});

it('surfaces validation errors when runner creation fails', function () {
    $fake = Mockery::mock(GithubRunnerInventory::class);
    $fake->shouldReceive('create')
        ->once()
        ->andThrow(Illuminate\Validation\ValidationException::withMessages([
            'github_app_uuid' => [
                'Permission insuffisante pour créer un runner sur bobdivx/popcorn-client. La GitHub App (ou le packages token) doit avoir le droit Administration (écriture) sur le dépôt.',
            ],
        ]));

    $this->app->instance(GithubRunnerInventory::class, $fake);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson('/api/devforge/v1/github/runners', [
            'auth_mode' => 'registration',
            'github_app_uuid' => 'app-uuid-test123',
            'owner' => 'bobdivx',
            'repo' => 'popcorn-client',
            'server_uuid' => $this->server->uuid,
            'runner_name' => 'devforge-runner-popcorn-client',
        ])
        ->assertUnprocessable()
        ->assertJsonValidationErrors(['github_app_uuid']);
});

it('surfaces unexpected create failures with the underlying message', function () {
    $fake = Mockery::mock(GithubRunnerInventory::class);
    $fake->shouldReceive('create')
        ->once()
        ->andThrow(new RuntimeException('ssh: connection refused'));

    $this->app->instance(GithubRunnerInventory::class, $fake);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson('/api/devforge/v1/github/runners', [
            'auth_mode' => 'registration',
            'github_app_uuid' => 'app-uuid-test123',
            'owner' => 'bobdivx',
            'repo' => 'popcorn-client',
            'server_uuid' => $this->server->uuid,
            'runner_name' => 'devforge-runner-popcorn-client',
        ])
        ->assertStatus(500)
        ->assertJsonPath('message', 'Impossible de créer le runner : ssh: connection refused');
});

it('recreates a github runner', function () {
    $fake = Mockery::mock(GithubRunnerInventory::class);
    $fake->shouldReceive('action')
        ->once()
        ->with(
            Mockery::type(Team::class),
            $this->server->uuid,
            'github-runner-server',
            'recreate',
        )
        ->andReturn([
            'ok' => true,
            'action' => 'recreate',
            'message' => 'Runner recréé (image tirée). Vérifiez « Version: 2.336.0 » dans les logs.',
            'runner' => [
                'id' => $this->server->uuid.':github-runner-server',
                'name' => 'github-runner-server',
                'state' => 'running',
                'server_uuid' => $this->server->uuid,
                'server_name' => 'zimacube',
                'runner_version' => '2.336.0',
                'node24_ready' => true,
            ],
        ]);

    $this->app->instance(GithubRunnerInventory::class, $fake);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson('/api/devforge/v1/github/runners/'.$this->server->uuid.'/github-runner-server/recreate')
        ->assertSuccessful()
        ->assertJsonPath('data.ok', true)
        ->assertJsonPath('data.action', 'recreate')
        ->assertJsonPath('message', 'Runner recréé (image tirée). Vérifiez « Version: 2.336.0 » dans les logs.');
});

it('deletes a github runner', function () {
    $fake = Mockery::mock(GithubRunnerInventory::class);
    $fake->shouldReceive('destroy')
        ->once()
        ->with(
            Mockery::type(Team::class),
            $this->server->uuid,
            'github-runner-client',
        )
        ->andReturn([
            'ok' => true,
            'message' => 'Runner supprimé.',
            'container' => 'github-runner-client',
        ]);

    $this->app->instance(GithubRunnerInventory::class, $fake);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->deleteJson('/api/devforge/v1/github/runners/'.$this->server->uuid.'/github-runner-client')
        ->assertSuccessful()
        ->assertJsonPath('data.ok', true)
        ->assertJsonPath('message', 'Runner supprimé.');
});
