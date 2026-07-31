<?php

use App\Models\Application;
use App\Models\Environment;
use App\Models\EnvironmentVariable;
use App\Models\Project;
use App\Models\Server;
use App\Models\StandaloneDocker;
use App\Models\StandaloneLibsql;
use App\Models\StandalonePostgresql;
use App\Models\Team;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
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
        'name' => 'Linked app',
        'environment_id' => $this->environment->id,
        'destination_id' => $this->destination->id,
        'destination_type' => StandaloneDocker::class,
        'git_repository' => 'acme/demo-app',
        'git_branch' => 'main',
    ]);

    $this->database = StandalonePostgresql::withoutEvents(fn () => StandalonePostgresql::create([
        'uuid' => fake()->uuid(),
        'name' => 'Linked database',
        'image' => 'postgres:17',
        'postgres_user' => 'postgres',
        'postgres_password' => 'secret-password',
        'postgres_db' => 'app',
        'status' => 'running:healthy',
        'environment_id' => $this->environment->id,
        'destination_id' => $this->destination->id,
        'destination_type' => StandaloneDocker::class,
    ]));
});

it('lists linkable databases for an application', function () {
    $otherEnvironment = Environment::factory()->create(['project_id' => $this->project->id]);
    StandaloneLibsql::withoutEvents(fn () => StandaloneLibsql::create([
        'uuid' => fake()->uuid(),
        'name' => 'Other env db',
        'libsql_auth_user' => 'libsql',
        'libsql_auth_token' => 'secret-token',
        'environment_id' => $otherEnvironment->id,
        'destination_id' => $this->destination->id,
        'destination_type' => StandaloneDocker::class,
    ]));

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson("/api/devforge/v1/applications/{$this->application->uuid}/linkable-databases")
        ->assertSuccessful()
        ->assertJsonPath('data.0.uuid', $this->database->uuid)
        ->assertJsonPath('data.0.engine', 'postgresql')
        ->assertJsonPath('data.0.default_env_key', 'DATABASE_URL')
        ->assertJsonPath('data.0.is_linkable', true)
        ->assertJsonPath('data.0.connected_applications', [])
        ->assertJsonCount(1, 'data');
});

it('connects a database to an application via environment variable', function () {
    Queue::fake();

    $response = $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson("/api/devforge/v1/applications/{$this->application->uuid}/connect-database", [
            'database_uuid' => $this->database->uuid,
            'instant_deploy' => true,
        ])
        ->assertSuccessful()
        ->assertJsonPath('data.env_key', 'DATABASE_URL')
        ->assertJsonPath('data.database_uuid', $this->database->uuid)
        ->assertJsonPath('data.deployment.queued', true);

    $variable = EnvironmentVariable::query()
        ->where('resourceable_type', Application::class)
        ->where('resourceable_id', $this->application->id)
        ->where('key', 'DATABASE_URL')
        ->first();

    expect($variable)->not->toBeNull()
        ->and($variable->real_value)->toBe($this->database->internal_db_url)
        ->and($variable->comment)->toBe('devforge:database:'.$this->database->uuid);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson("/api/devforge/v1/applications/{$this->application->uuid}/linkable-databases")
        ->assertSuccessful()
        ->assertJsonPath('meta.connections.0.database_uuid', $this->database->uuid)
        ->assertJsonPath('meta.connections.0.env_keys', ['DATABASE_URL'])
        ->assertJsonPath('data.0.uuid', $this->database->uuid)
        ->assertJsonPath('data.0.is_linkable', false)
        ->assertJsonPath('data.0.connected_applications.0.application_name', 'Linked app')
        ->assertJsonCount(1, 'data');
});

it('marks databases already connected to another application as not linkable', function () {
    $secondDatabase = StandalonePostgresql::withoutEvents(fn () => StandalonePostgresql::create([
        'uuid' => fake()->uuid(),
        'name' => 'Second database',
        'image' => 'postgres:17',
        'postgres_user' => 'postgres',
        'postgres_password' => 'secret-password',
        'postgres_db' => 'app2',
        'environment_id' => $this->environment->id,
        'destination_id' => $this->destination->id,
        'destination_type' => StandaloneDocker::class,
    ]));

    $otherApplication = Application::factory()->create([
        'name' => 'Other app',
        'environment_id' => $this->environment->id,
        'destination_id' => $this->destination->id,
        'destination_type' => StandaloneDocker::class,
        'git_repository' => 'acme/other-app',
        'git_branch' => 'main',
    ]);

    $otherApplication->environment_variables()->create([
        'key' => 'DATABASE_URL',
        'value' => $this->database->internal_db_url,
        'comment' => 'devforge:database:'.$this->database->uuid,
        'is_preview' => false,
        'is_runtime' => true,
        'is_buildtime' => true,
    ]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson("/api/devforge/v1/applications/{$this->application->uuid}/linkable-databases")
        ->assertSuccessful()
        ->assertJsonCount(2, 'data')
        ->assertJsonPath('data.0.uuid', $this->database->uuid)
        ->assertJsonPath('data.0.is_linkable', false)
        ->assertJsonPath('data.0.connected_applications.0.application_name', 'Other app')
        ->assertJsonPath('data.1.uuid', $secondDatabase->uuid)
        ->assertJsonPath('data.1.is_linkable', true);
});

it('rejects connecting a database already attached to another application', function () {
    $otherApplication = Application::factory()->create([
        'name' => 'Other app',
        'environment_id' => $this->environment->id,
        'destination_id' => $this->destination->id,
        'destination_type' => StandaloneDocker::class,
        'git_repository' => 'acme/other-app',
        'git_branch' => 'main',
    ]);

    $otherApplication->environment_variables()->create([
        'key' => 'DATABASE_URL',
        'value' => $this->database->internal_db_url,
        'comment' => 'devforge:database:'.$this->database->uuid,
        'is_preview' => false,
        'is_runtime' => true,
        'is_buildtime' => true,
    ]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson("/api/devforge/v1/applications/{$this->application->uuid}/connect-database", [
            'database_uuid' => $this->database->uuid,
        ])
        ->assertStatus(422);
});

it('keeps already connected databases visible but not linkable', function () {
    $secondDatabase = StandalonePostgresql::withoutEvents(fn () => StandalonePostgresql::create([
        'uuid' => fake()->uuid(),
        'name' => 'Second database',
        'image' => 'postgres:17',
        'postgres_user' => 'postgres',
        'postgres_password' => 'secret-password',
        'postgres_db' => 'app2',
        'environment_id' => $this->environment->id,
        'destination_id' => $this->destination->id,
        'destination_type' => StandaloneDocker::class,
    ]));

    $this->application->environment_variables()->create([
        'key' => 'DATABASE_URL',
        'value' => $this->database->internal_db_url,
        'comment' => 'devforge:database:'.$this->database->uuid,
        'is_preview' => false,
        'is_runtime' => true,
        'is_buildtime' => true,
    ]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson("/api/devforge/v1/applications/{$this->application->uuid}/linkable-databases")
        ->assertSuccessful()
        ->assertJsonCount(2, 'data')
        ->assertJsonPath('data.0.uuid', $this->database->uuid)
        ->assertJsonPath('data.0.is_linkable', false)
        ->assertJsonPath('data.1.uuid', $secondDatabase->uuid)
        ->assertJsonPath('data.1.is_linkable', true);
});

it('rejects connecting a database from another destination', function () {
    $otherServer = Server::factory()->create(['team_id' => $this->team->id]);
    $otherDestination = $otherServer->standaloneDockers()->firstOrFail();

    $otherDatabase = StandalonePostgresql::withoutEvents(fn () => StandalonePostgresql::create([
        'uuid' => fake()->uuid(),
        'name' => 'Remote database',
        'image' => 'postgres:17',
        'postgres_user' => 'postgres',
        'postgres_password' => 'secret-password',
        'postgres_db' => 'app',
        'environment_id' => $this->environment->id,
        'destination_id' => $otherDestination->id,
        'destination_type' => StandaloneDocker::class,
    ]));

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson("/api/devforge/v1/applications/{$this->application->uuid}/connect-database", [
            'database_uuid' => $otherDatabase->uuid,
        ])
        ->assertStatus(422);
});

it('uses TURSO_DATABASE_URL and TURSO_AUTH_TOKEN by default for libsql databases', function () {
    Queue::fake();

    $libsql = StandaloneLibsql::withoutEvents(fn () => StandaloneLibsql::create([
        'uuid' => fake()->uuid(),
        'name' => 'Edge db',
        'libsql_auth_user' => 'libsql',
        'libsql_auth_token' => 'secret-token',
        'status' => 'running:healthy',
        'environment_id' => $this->environment->id,
        'destination_id' => $this->destination->id,
        'destination_type' => StandaloneDocker::class,
    ]));

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson("/api/devforge/v1/applications/{$this->application->uuid}/connect-database", [
            'database_uuid' => $libsql->uuid,
            'instant_deploy' => false,
        ])
        ->assertSuccessful()
        ->assertJsonPath('data.env_key', 'TURSO_DATABASE_URL')
        ->assertJsonPath('data.env_keys', ['TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN']);

    $urlVariable = EnvironmentVariable::query()
        ->where('resourceable_id', $this->application->id)
        ->where('key', 'TURSO_DATABASE_URL')
        ->first();

    $tokenVariable = EnvironmentVariable::query()
        ->where('resourceable_id', $this->application->id)
        ->where('key', 'TURSO_AUTH_TOKEN')
        ->first();

    expect($urlVariable)->not->toBeNull()
        ->and($urlVariable->real_value)->toBe("libsql://{$libsql->uuid}:8080")
        ->and($tokenVariable)->not->toBeNull()
        ->and($tokenVariable->real_value)->toBe('secret-token');
});

it('reuses existing TURSO variables when connecting a libsql database', function () {
    $this->application->environment_variables()->create([
        'key' => 'TURSO_DATABASE_URL',
        'value' => 'libsql://old-host:8080',
        'is_preview' => false,
        'is_runtime' => true,
        'is_buildtime' => false,
    ]);

    $libsql = StandaloneLibsql::withoutEvents(fn () => StandaloneLibsql::create([
        'uuid' => fake()->uuid(),
        'name' => 'Turso app db',
        'libsql_auth_user' => 'libsql',
        'libsql_auth_token' => 'rotated-token',
        'status' => 'running:healthy',
        'environment_id' => $this->environment->id,
        'destination_id' => $this->destination->id,
        'destination_type' => StandaloneDocker::class,
    ]));

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson("/api/devforge/v1/applications/{$this->application->uuid}/connect-database", [
            'database_uuid' => $libsql->uuid,
            'instant_deploy' => false,
        ])
        ->assertSuccessful()
        ->assertJsonPath('data.env_keys', ['TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN']);

    expect(EnvironmentVariable::query()->where('resourceable_id', $this->application->id)->where('key', 'TURSO_DATABASE_URL')->first()?->real_value)
        ->toBe("libsql://{$libsql->uuid}:8080");
});

it('keeps LIBSQL_URL when the application already uses it', function () {
    $this->application->environment_variables()->create([
        'key' => 'LIBSQL_URL',
        'value' => 'libsql://old:pass@host:8080',
        'is_preview' => false,
        'is_runtime' => true,
        'is_buildtime' => false,
    ]);

    $libsql = StandaloneLibsql::withoutEvents(fn () => StandaloneLibsql::create([
        'uuid' => fake()->uuid(),
        'name' => 'Libsql url db',
        'libsql_auth_user' => 'libsql',
        'libsql_auth_token' => 'secret-token',
        'status' => 'running:healthy',
        'environment_id' => $this->environment->id,
        'destination_id' => $this->destination->id,
        'destination_type' => StandaloneDocker::class,
    ]));

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson("/api/devforge/v1/applications/{$this->application->uuid}/connect-database", [
            'database_uuid' => $libsql->uuid,
            'instant_deploy' => false,
        ])
        ->assertSuccessful()
        ->assertJsonPath('data.env_keys', ['LIBSQL_URL', 'TURSO_AUTH_TOKEN']);

    expect(EnvironmentVariable::query()->where('resourceable_id', $this->application->id)->where('key', 'LIBSQL_URL')->first()?->real_value)
        ->toBe("libsql://{$libsql->uuid}:8080")
        ->and(EnvironmentVariable::query()->where('resourceable_id', $this->application->id)->where('key', 'TURSO_AUTH_TOKEN')->first()?->real_value)
        ->toBe('secret-token');
});

it('groups libsql connection variables into a single application connection', function () {
    $libsql = StandaloneLibsql::withoutEvents(fn () => StandaloneLibsql::create([
        'uuid' => fake()->uuid(),
        'name' => 'Grouped db',
        'libsql_auth_user' => 'libsql',
        'libsql_auth_token' => 'secret-token',
        'status' => 'running:healthy',
        'environment_id' => $this->environment->id,
        'destination_id' => $this->destination->id,
        'destination_type' => StandaloneDocker::class,
    ]));

    $comment = 'devforge:database:'.$libsql->uuid;

    foreach (['TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN', 'LIBSQL_URL'] as $key) {
        $this->application->environment_variables()->create([
            'key' => $key,
            'value' => 'placeholder',
            'comment' => $comment,
            'is_preview' => false,
            'is_runtime' => true,
            'is_buildtime' => true,
        ]);
    }

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson("/api/devforge/v1/applications/{$this->application->uuid}/linkable-databases")
        ->assertSuccessful()
        ->assertJsonCount(1, 'meta.connections')
        ->assertJsonPath('meta.connections.0.database_uuid', $libsql->uuid)
        ->assertJsonPath('meta.connections.0.env_keys', ['LIBSQL_URL', 'TURSO_AUTH_TOKEN', 'TURSO_DATABASE_URL']);
});

it('removes stale linked libsql variables when applying a turso connection', function () {
    $libsql = StandaloneLibsql::withoutEvents(fn () => StandaloneLibsql::create([
        'uuid' => fake()->uuid(),
        'name' => 'Cleanup db',
        'libsql_auth_user' => 'libsql',
        'libsql_auth_token' => 'secret-token',
        'status' => 'running:healthy',
        'environment_id' => $this->environment->id,
        'destination_id' => $this->destination->id,
        'destination_type' => StandaloneDocker::class,
    ]));

    $comment = 'devforge:database:'.$libsql->uuid;

    $this->application->environment_variables()->create([
        'key' => 'LIBSQL_URL',
        'value' => 'libsql://old:pass@host:8080',
        'comment' => $comment,
        'is_preview' => false,
        'is_runtime' => true,
        'is_buildtime' => true,
    ]);

    app(\App\Services\DevForge\Database\LibsqlConnectionEnvSync::class)->applyConnection(
        $this->application,
        $libsql,
        'TURSO_DATABASE_URL',
        true,
        true,
    );

    expect(EnvironmentVariable::query()->where('resourceable_id', $this->application->id)->where('key', 'LIBSQL_URL')->exists())
        ->toBeFalse()
        ->and(EnvironmentVariable::query()->where('resourceable_id', $this->application->id)->where('key', 'TURSO_DATABASE_URL')->exists())
        ->toBeTrue()
        ->and(EnvironmentVariable::query()->where('resourceable_id', $this->application->id)->where('key', 'TURSO_AUTH_TOKEN')->exists())
        ->toBeTrue();
});
