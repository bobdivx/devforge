<?php

use App\Models\GithubManagedRunner;
use App\Models\Server;
use App\Models\Team;
use App\Models\User;
use App\Services\DevForge\Github\GithubAppCatalog;
use App\Services\DevForge\Github\GithubRunnerApplicationLinker;
use App\Services\DevForge\Github\GithubRunnerInventory;
use App\Services\DevForge\Github\GithubRunnerReconcileService;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

beforeEach(function () {
    config()->set('devforge.enabled', true);

    $this->user = User::factory()->create();
    $this->team = $this->user->teams()->firstOrFail();
    $this->server = Server::factory()->create([
        'team_id' => $this->team->id,
        'name' => 'zimacube',
    ]);
    $this->server->settings()->update([
        'is_reachable' => true,
        'is_usable' => true,
        'force_disabled' => false,
    ]);
});

it('merges managed desired-state runners missing from docker inventory', function () {
    GithubManagedRunner::query()->create([
        'team_id' => $this->team->id,
        'server_uuid' => $this->server->uuid,
        'container_name' => 'github-runner-popcorn-client',
        'runner_name' => 'casaos-runner-popcorn-client',
        'owner' => 'bobdivx',
        'repo' => 'popcorn-client',
        'repo_url' => 'https://github.com/bobdivx/popcorn-client',
        'image' => 'ghcr.io/bobdivx/popcorn-github-runner-client:latest',
        'labels' => 'self-hosted,devforge',
        'network_mode' => 'bridge',
        'timezone' => 'Europe/Paris',
        'auth_mode' => 'pat',
        'enabled' => true,
    ]);

    $linker = Mockery::mock(GithubRunnerApplicationLinker::class);
    $linker->shouldReceive('linksForRunner')->andReturn([]);

    $inventory = new GithubRunnerInventory(Mockery::mock(GithubAppCatalog::class), $linker);
    $merged = $inventory->mergeManagedDesiredState($this->team, collect([]));

    expect($merged)->toHaveCount(1)
        ->and($merged->first()['name'])->toBe('github-runner-popcorn-client')
        ->and($merged->first()['state'])->toBe('missing')
        ->and($merged->first()['managed'])->toBeTrue()
        ->and($merged->first()['repo_url'])->toBe('https://github.com/bobdivx/popcorn-client')
        ->and($merged->first())->toHaveKey('last_reconcile_error');
});

it('marks already running managed runners without recreation', function () {
    $managed = GithubManagedRunner::query()->create([
        'team_id' => $this->team->id,
        'server_uuid' => $this->server->uuid,
        'container_name' => 'github-runner-popcorn-server',
        'runner_name' => 'casaos-runner-popcorn-server',
        'owner' => 'bobdivx',
        'repo' => 'popcorn-server',
        'repo_url' => 'https://github.com/bobdivx/popcorn-server',
        'image' => 'ghcr.io/bobdivx/popcorn-github-runner-server:latest',
        'auth_mode' => 'pat',
        'enabled' => true,
    ]);

    $inventory = Mockery::mock(GithubRunnerInventory::class);
    $inventory->shouldReceive('isContainerRunning')
        ->once()
        ->with(Mockery::type(Server::class), 'github-runner-popcorn-server')
        ->andReturn(true);
    $inventory->shouldReceive('recreateFromManaged')->never();

    $this->app->instance(GithubRunnerInventory::class, $inventory);

    $result = app(GithubRunnerReconcileService::class)->ensureRunning($managed->fresh());

    expect($result)->toBe('already_running')
        ->and($managed->fresh()->last_reconcile_error)->toBeNull()
        ->and($managed->fresh()->last_reconciled_at)->not->toBeNull();
});

it('recreates missing managed runners during reconcile', function () {
    $managed = GithubManagedRunner::query()->create([
        'team_id' => $this->team->id,
        'server_uuid' => $this->server->uuid,
        'container_name' => 'github-runner-popcorn-tauri',
        'runner_name' => 'casaos-runner-popcorn-tauri',
        'owner' => 'bobdivx',
        'repo' => 'popcorn-tauri',
        'repo_url' => 'https://github.com/bobdivx/popcorn-tauri',
        'image' => 'ghcr.io/bobdivx/popcorn-github-runner-server:latest',
        'auth_mode' => 'pat',
        'enabled' => true,
    ]);

    $inventory = Mockery::mock(GithubRunnerInventory::class);
    $inventory->shouldReceive('isContainerRunning')->once()->andReturn(false);
    $inventory->shouldReceive('recreateFromManaged')
        ->once()
        ->with(
            Mockery::on(fn (Team $team): bool => $team->id === $this->team->id),
            Mockery::on(fn (Server $server): bool => $server->uuid === $this->server->uuid),
            Mockery::on(fn (GithubManagedRunner $runner): bool => $runner->id === $managed->id),
        );

    $this->app->instance(GithubRunnerInventory::class, $inventory);

    $result = app(GithubRunnerReconcileService::class)->ensureRunning($managed->fresh());

    expect($result)->toBe('started')
        ->and($managed->fresh()->last_reconciled_at)->not->toBeNull();
});
