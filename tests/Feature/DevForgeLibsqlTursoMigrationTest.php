<?php

use App\Models\Application;
use App\Models\Environment;
use App\Models\Project;
use App\Models\Server;
use App\Models\StandaloneDocker;
use App\Models\StandaloneLibsql;
use App\Models\User;
use App\Services\DevForge\Database\LibsqlDatabaseTransferService;
use App\Services\DevForge\Database\LibsqlTursoMigrationService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;

uses(RefreshDatabase::class);

beforeEach(function () {
    config()->set('devforge.enabled', true);

    $this->user = User::factory()->create();
    $this->team = $this->user->teams()->firstOrFail();
    $this->session = ['currentTeam' => $this->team];

    $this->server = Server::factory()->create([
        'team_id' => $this->team->id,
    ]);
    $this->destination = $this->server->standaloneDockers()->firstOrFail();
    $this->project = Project::factory()->create(['team_id' => $this->team->id]);
    $this->environment = Environment::factory()->create(['project_id' => $this->project->id]);

    $this->application = Application::factory()->create([
        'name' => 'Turso app',
        'environment_id' => $this->environment->id,
        'destination_id' => $this->destination->id,
        'destination_type' => StandaloneDocker::class,
        'git_repository' => 'acme/turso-app',
        'git_branch' => 'main',
    ]);

    $this->database = StandaloneLibsql::withoutEvents(fn () => StandaloneLibsql::create([
        'uuid' => 'w5gu3c9d5ezohux0wv63s5m4',
        'name' => 'Local libsql',
        'libsql_auth_user' => 'libsql',
        'libsql_auth_token' => 'local-token',
        'status' => 'running:healthy',
        'environment_id' => $this->environment->id,
        'destination_id' => $this->destination->id,
        'destination_type' => StandaloneDocker::class,
    ]));
});

it('detects a remote turso migration candidate from application variables', function () {
    $this->application->environment_variables()->create([
        'key' => 'TURSO_DATABASE_URL',
        'value' => 'libsql://mydb-myorg.turso.io',
        'is_preview' => false,
        'is_runtime' => true,
        'is_buildtime' => true,
    ]);
    $this->application->environment_variables()->create([
        'key' => 'TURSO_AUTH_TOKEN',
        'value' => 'remote-token',
        'is_preview' => false,
        'is_runtime' => true,
        'is_buildtime' => true,
    ]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson("/api/devforge/v1/applications/{$this->application->uuid}/linkable-databases")
        ->assertSuccessful()
        ->assertJsonPath('meta.turso_migration.available', true)
        ->assertJsonPath('meta.turso_migration.source_url', 'libsql://mydb-myorg.turso.io')
        ->assertJsonPath('meta.turso_migration.env_keys', ['TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN']);
});

it('does not offer turso migration when variables already point to a local devforge database', function () {
    $this->application->environment_variables()->create([
        'key' => 'TURSO_DATABASE_URL',
        'value' => 'libsql://w5gu3c9d5ezohux0wv63s5m4:8080',
        'is_preview' => false,
        'is_runtime' => true,
        'is_buildtime' => true,
    ]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson("/api/devforge/v1/applications/{$this->application->uuid}/linkable-databases")
        ->assertSuccessful()
        ->assertJsonPath('meta.turso_migration', null);
});

it('migrates remote turso data before connecting a libsql database', function () {
    Queue::fake();

    $this->application->environment_variables()->create([
        'key' => 'TURSO_DATABASE_URL',
        'value' => 'libsql://mydb-myorg.turso.io',
        'is_preview' => false,
        'is_runtime' => true,
        'is_buildtime' => true,
    ]);
    $this->application->environment_variables()->create([
        'key' => 'TURSO_AUTH_TOKEN',
        'value' => 'remote-token',
        'is_preview' => false,
        'is_runtime' => true,
        'is_buildtime' => true,
    ]);

    Http::fake([
        'https://mydb-myorg.turso.io/dump' => Http::response("PRAGMA foreign_keys=OFF;\nCREATE TABLE users (id INTEGER);\n"),
    ]);

    $this->mock(LibsqlDatabaseTransferService::class, function ($mock): void {
        $mock->shouldReceive('importPayload')
            ->once()
            ->withArgs(fn ($database, string $sql): bool => $database->uuid === 'w5gu3c9d5ezohux0wv63s5m4'
                && str_contains($sql, 'CREATE TABLE users'))
            ->andReturn([
                'restarted' => true,
                'format' => 'sql',
                'message' => 'Import terminé. La base redémarre.',
            ]);
    });

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson("/api/devforge/v1/applications/{$this->application->uuid}/connect-database", [
            'database_uuid' => $this->database->uuid,
            'migrate_from_remote' => true,
            'instant_deploy' => false,
        ])
        ->assertSuccessful()
        ->assertJsonPath('data.migration.performed', true)
        ->assertJsonPath('data.env_keys', ['TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN']);
});

it('dumps remote turso databases over http', function () {
    Http::fake([
        'https://mydb-myorg.turso.io/dump' => Http::response("PRAGMA foreign_keys=OFF;\nCREATE TABLE items (id INTEGER);\n"),
    ]);

    $service = app(LibsqlTursoMigrationService::class);
    $sql = $service->dumpRemote('https://mydb-myorg.turso.io', 'remote-token');

    expect($sql)->toContain('CREATE TABLE items');

    Http::assertSent(function ($request): bool {
        return $request->url() === 'https://mydb-myorg.turso.io/dump'
            && $request->hasHeader('Authorization', 'Bearer remote-token');
    });
});

it('creates a libsql database and migrates turso data when requested', function () {
    StartDatabase::shouldRun()->never();

    $this->application->environment_variables()->create([
        'key' => 'TURSO_DATABASE_URL',
        'value' => 'libsql://mydb-myorg.turso.io',
        'is_preview' => false,
        'is_runtime' => true,
        'is_buildtime' => true,
    ]);
    $this->application->environment_variables()->create([
        'key' => 'TURSO_AUTH_TOKEN',
        'value' => 'remote-token',
        'is_preview' => false,
        'is_runtime' => true,
        'is_buildtime' => true,
    ]);

    Http::fake([
        'https://mydb-myorg.turso.io/dump' => Http::response("PRAGMA foreign_keys=OFF;\nCREATE TABLE notes (id INTEGER);\n"),
    ]);

    $this->mock(LibsqlDatabaseTransferService::class, function ($mock): void {
        $mock->shouldReceive('importPayload')
            ->once()
            ->withArgs(fn ($database, string $sql): bool => str_contains($sql, 'CREATE TABLE notes'))
            ->andReturn([
                'restarted' => true,
                'format' => 'sql',
                'message' => 'Import terminé. La base redémarre.',
            ]);
    });

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson('/api/devforge/v1/databases', [
            'engine' => 'libsql',
            'project_uuid' => $this->project->uuid,
            'environment_uuid' => $this->environment->uuid,
            'destination_uuid' => $this->destination->uuid,
            'application_uuid' => $this->application->uuid,
            'migrate_from_remote' => true,
            'instant_deploy' => true,
            'application_instant_deploy' => false,
        ])
        ->assertCreated()
        ->assertJsonPath('data.name', 'Turso app · libSQL')
        ->assertJsonPath('meta.connection.migration.performed', true)
        ->assertJsonPath('meta.connection.env_keys', ['TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN']);
});

it('returns a readable error when turso dump cannot be reached', function () {
    Http::fake(function () {
        throw new \Illuminate\Http\Client\ConnectionException('Connection refused');
    });

    $service = app(LibsqlTursoMigrationService::class);

    expect(fn () => $service->dumpRemote('https://mydb-myorg.turso.io', 'remote-token'))
        ->toThrow(\Symfony\Component\HttpKernel\Exception\HttpException::class, 'Impossible de joindre la base Turso distante');
});
