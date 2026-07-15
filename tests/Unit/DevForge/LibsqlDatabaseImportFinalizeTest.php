<?php

use App\Models\Environment;
use App\Models\Project;
use App\Models\Server;
use App\Models\StandaloneDocker;
use App\Models\StandaloneLibsql;
use App\Services\DevForge\Database\DatabaseImportFinalizer;
use App\Services\DevForge\Database\LinkedDatabaseEnvSync;
use App\Services\DevForge\Database\StandaloneDatabaseRuntimeGuard;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

it('finalizes imports by ensuring runtime and syncing linked applications', function () {
    $server = Server::factory()->create();
    $destination = $server->standaloneDockers()->firstOrFail();
    $project = Project::factory()->create(['team_id' => $server->team_id]);
    $environment = Environment::factory()->create(['project_id' => $project->id]);

    $database = StandaloneLibsql::withoutEvents(fn () => StandaloneLibsql::create([
        'uuid' => fake()->uuid(),
        'name' => 'libsql-database-test',
        'libsql_auth_user' => 'libsql',
        'libsql_auth_token' => 'secret-token',
        'environment_id' => $environment->id,
        'destination_id' => $destination->id,
        'destination_type' => StandaloneDocker::class,
    ]));

    $sync = Mockery::mock(LinkedDatabaseEnvSync::class);
    $guard = Mockery::mock(StandaloneDatabaseRuntimeGuard::class);

    $guard->shouldReceive('ensureRunning')->once()->with($database);
    $sync->shouldReceive('syncLinkedApplications')
        ->once()
        ->with($database, true)
        ->andReturn([
            'updated_variables' => 2,
            'applications' => [
                ['uuid' => 'app-uuid', 'name' => 'linked-app'],
            ],
            'redeployments_queued' => 1,
        ]);

    $finalizer = new DatabaseImportFinalizer($guard, $sync);
    $result = $finalizer->finalize($database, 'db', 'Import du fichier .db terminé. La base est active.');

    expect($result['format'])->toBe('db')
        ->and($result['env_variables_synced'])->toBe(2)
        ->and($result['redeployments_queued'])->toBe(1)
        ->and($result['linked_applications'])->toHaveCount(1)
        ->and($result['message'])->toContain('2 variable(s) d’environnement synchronisée(s)')
        ->and($result['message'])->toContain('1 redéploiement(s) planifié(s)');
});

it('skips ensure running when database is already active', function () {
    $server = Server::factory()->create(['settings' => ['is_reachable' => true, 'is_usable' => true]]);
    $destination = $server->standaloneDockers()->firstOrFail();
    $project = Project::factory()->create(['team_id' => $server->team_id]);
    $environment = Environment::factory()->create(['project_id' => $project->id]);

    $database = StandaloneLibsql::withoutEvents(fn () => StandaloneLibsql::create([
        'uuid' => fake()->uuid(),
        'name' => 'running-db',
        'libsql_auth_user' => 'libsql',
        'libsql_auth_token' => 'secret-token',
        'status' => 'running:healthy',
        'environment_id' => $environment->id,
        'destination_id' => $destination->id,
        'destination_type' => StandaloneDocker::class,
    ]));

    $guard = new StandaloneDatabaseRuntimeGuard;

    expect($guard->ensureRunning($database))->toBeFalse();
});
