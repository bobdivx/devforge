<?php

use App\Models\Application;
use App\Models\StandaloneLibsql;
use App\Models\Team;
use App\Services\DevForge\Core\CoreResourceCatalog;
use App\Services\DevForge\Database\DatabaseDesiredRuntimeState;
use App\Services\DevForge\Database\DatabaseKeepAliveService;
use App\Services\DevForge\Database\StandaloneDatabaseRuntimeGuard;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Cache;
use Mockery;

beforeEach(function () {
    Cache::flush();
    config()->set('devforge.enabled', true);
    config()->set('devforge.database_keep_alive.enabled', true);
    config()->set('devforge.database_keep_alive.desired_ttl_seconds', 3600);
});

function makeKeepAliveDatabase(string $uuid, string $status): StandaloneLibsql
{
    $database = Mockery::mock(StandaloneLibsql::class)->makePartial();
    $database->uuid = $uuid;
    $database->status = $status;
    $database->shouldReceive('getMorphClass')->andReturn(StandaloneLibsql::class);

    return $database;
}

it('restarts desired stopped databases via the runtime guard', function () {
    $team = Team::factory()->make(['id' => 31]);
    $stopped = makeKeepAliveDatabase('db-keep-1', 'exited:unhealthy');

    $desired = new DatabaseDesiredRuntimeState;
    $desired->markDesiredRunning($stopped);

    $catalog = Mockery::mock(CoreResourceCatalog::class);
    $catalog->shouldReceive('resources')
        ->with($team, 'databases')
        ->andReturn(new Collection([$stopped]));

    $guard = Mockery::mock(StandaloneDatabaseRuntimeGuard::class);
    $guard->shouldReceive('ensureRunning')
        ->once()
        ->with($stopped)
        ->andReturn(true);

    $keepAlive = new DatabaseKeepAliveService($catalog, $guard, $desired);
    $result = $keepAlive->tickTeam($team);

    expect($result['restarted'])->toBe(['db-keep-1']);
});

it('does not restart a database stopped on purpose', function () {
    $team = Team::factory()->make(['id' => 32]);
    $stopped = makeKeepAliveDatabase('db-keep-2', 'exited:unhealthy');

    $desired = new DatabaseDesiredRuntimeState;
    $desired->markDesiredStopped($stopped);

    $catalog = Mockery::mock(CoreResourceCatalog::class);
    $catalog->shouldReceive('resources')
        ->with($team, 'databases')
        ->andReturn(new Collection([$stopped]));

    $guard = Mockery::mock(StandaloneDatabaseRuntimeGuard::class);
    $guard->shouldReceive('ensureRunning')->never();

    $keepAlive = new DatabaseKeepAliveService($catalog, $guard, $desired);
    $result = $keepAlive->tickTeam($team);

    expect($result['restarted'])->toBe([]);
});

it('marks running databases as desired running', function () {
    $team = Team::factory()->make(['id' => 33]);
    $running = makeKeepAliveDatabase('db-keep-3', 'running:healthy');

    $desired = new DatabaseDesiredRuntimeState;

    $catalog = Mockery::mock(CoreResourceCatalog::class);
    $catalog->shouldReceive('resources')
        ->with($team, 'databases')
        ->andReturn(new Collection([$running]));

    $guard = Mockery::mock(StandaloneDatabaseRuntimeGuard::class);
    $guard->shouldReceive('ensureRunning')->never();

    $keepAlive = new DatabaseKeepAliveService($catalog, $guard, $desired);
    $keepAlive->tickTeam($team);

    expect($desired->isDesiredRunning($running))->toBeTrue();
});
