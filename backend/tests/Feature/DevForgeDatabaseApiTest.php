<?php

use App\Actions\Database\StartDatabase;
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
});

it('creates a postgresql database for the current team', function () {
    StartDatabase::shouldRun()->once()->andReturn('started');

    $response = $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson('/api/devforge/v1/databases', [
            'engine' => 'postgresql',
            'project_uuid' => $this->project->uuid,
            'environment_uuid' => $this->environment->uuid,
            'destination_uuid' => $this->destination->uuid,
            'name' => 'Analytics DB',
            'image' => 'postgres:17-alpine',
            'instant_deploy' => true,
        ])
        ->assertCreated()
        ->assertJsonPath('data.type', 'database')
        ->assertJsonPath('data.name', 'Analytics DB')
        ->assertJsonPath('data.engine', 'postgresql')
        ->assertJsonPath('data.configuration.image', 'postgres:17-alpine')
        ->assertJsonPath('meta.instant_deploy', true);

    $uuid = $response->json('data.uuid');
    expect($uuid)->not->toBeEmpty();

    $database = StandalonePostgresql::query()->where('uuid', $uuid)->first();
    expect($database)->not->toBeNull()
        ->and($database->environment_id)->toBe($this->environment->id)
        ->and($database->destination_id)->toBe($this->destination->id);
});

it('creates a libsql database for the current team', function () {
    StartDatabase::shouldRun()->once()->andReturn('started');

    $response = $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson('/api/devforge/v1/databases', [
            'engine' => 'libsql',
            'project_uuid' => $this->project->uuid,
            'environment_uuid' => $this->environment->uuid,
            'destination_uuid' => $this->destination->uuid,
            'name' => 'Edge SQLite',
            'instant_deploy' => true,
        ])
        ->assertCreated()
        ->assertJsonPath('data.type', 'database')
        ->assertJsonPath('data.name', 'Edge SQLite')
        ->assertJsonPath('data.engine', 'libsql')
        ->assertJsonPath('data.configuration.image', 'ghcr.io/tursodatabase/libsql-server:latest');

    $uuid = $response->json('data.uuid');
    $database = StandaloneLibsql::query()->where('uuid', $uuid)->first();
    expect($database)->not->toBeNull()
        ->and($database->libsql_auth_user)->toBe('libsql')
        ->and($database->libsql_auth_token)->not->toBeEmpty()
        ->and(substr_count((string) $database->libsql_auth_token, '.'))->toBe(2)
        ->and($database->libsql_jwt_public_key)->not->toBeEmpty()
        ->and($database->libsql_jwt_secret_key)->not->toBeEmpty()
        ->and($database->environment_id)->toBe($this->environment->id);
});

it('creates a redis database without instant deploy', function () {
    StartDatabase::shouldRun()->never();

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson('/api/devforge/v1/databases', [
            'engine' => 'redis',
            'project_uuid' => $this->project->uuid,
            'environment_uuid' => $this->environment->uuid,
            'destination_uuid' => $this->destination->uuid,
            'instant_deploy' => false,
        ])
        ->assertCreated()
        ->assertJsonPath('data.engine', 'redis')
        ->assertJsonPath('meta.instant_deploy', false);
});

it('rejects database creation with a destination from another team', function () {
    $otherTeam = Team::factory()->create();
    $otherServer = Server::factory()->create(['team_id' => $otherTeam->id]);
    $otherDestination = $otherServer->standaloneDockers()->firstOrFail();

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson('/api/devforge/v1/databases', [
            'engine' => 'postgresql',
            'project_uuid' => $this->project->uuid,
            'environment_uuid' => $this->environment->uuid,
            'destination_uuid' => $otherDestination->uuid,
        ])
        ->assertNotFound();
});

it('rejects unsupported database engines', function () {
    $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson('/api/devforge/v1/databases', [
            'engine' => 'sqlite',
            'project_uuid' => $this->project->uuid,
            'environment_uuid' => $this->environment->uuid,
            'destination_uuid' => $this->destination->uuid,
        ])
        ->assertUnprocessable();
});

it('connects a created libsql database to an application when requested', function () {
    StartDatabase::shouldRun()->once()->andReturn('started');

    $application = Application::factory()->create([
        'name' => 'Demo app',
        'environment_id' => $this->environment->id,
        'destination_id' => $this->destination->id,
        'destination_type' => StandaloneDocker::class,
        'git_repository' => 'acme/demo-app',
        'git_branch' => 'main',
    ]);

    $response = $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson('/api/devforge/v1/databases', [
            'engine' => 'libsql',
            'project_uuid' => $this->project->uuid,
            'environment_uuid' => $this->environment->uuid,
            'destination_uuid' => $this->destination->uuid,
            'application_uuid' => $application->uuid,
            'application_instant_deploy' => false,
            'instant_deploy' => true,
        ])
        ->assertCreated()
        ->assertJsonPath('data.name', 'Demo app · libSQL')
        ->assertJsonPath('meta.connection.env_key', 'TURSO_DATABASE_URL')
        ->assertJsonPath('meta.connection.env_keys', ['TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN'])
        ->assertJsonPath('meta.connection.application_uuid', $application->uuid);

    $databaseUuid = $response->json('data.uuid');

    $urlVariable = EnvironmentVariable::query()
        ->where('resourceable_type', Application::class)
        ->where('resourceable_id', $application->id)
        ->where('key', 'TURSO_DATABASE_URL')
        ->first();

    $tokenVariable = EnvironmentVariable::query()
        ->where('resourceable_type', Application::class)
        ->where('resourceable_id', $application->id)
        ->where('key', 'TURSO_AUTH_TOKEN')
        ->first();

    expect($urlVariable)->not->toBeNull()
        ->and($urlVariable->comment)->toBe('devforge:database:'.$databaseUuid)
        ->and($urlVariable->real_value)->not->toContain('@')
        ->and($tokenVariable)->not->toBeNull();
});

it('lists applications connected to a database', function () {
    $application = Application::factory()->create([
        'name' => 'Demo app',
        'environment_id' => $this->environment->id,
        'destination_id' => $this->destination->id,
        'destination_type' => StandaloneDocker::class,
        'git_repository' => 'acme/demo-app',
        'git_branch' => 'main',
    ]);

    $database = StandaloneLibsql::withoutEvents(fn () => StandaloneLibsql::create([
        'uuid' => 'xh3p62lu1pp006q3zkyocui4',
        'name' => 'Edge db',
        'libsql_auth_user' => 'libsql',
        'libsql_auth_token' => 'secret-token',
        'environment_id' => $this->environment->id,
        'destination_id' => $this->destination->id,
        'destination_type' => StandaloneDocker::class,
    ]));

    $application->environment_variables()->create([
        'key' => 'LIBSQL_URL',
        'value' => 'libsql://libsql:secret@xh3p62lu1pp006q3zkyocui4:8080',
        'is_runtime' => true,
        'is_buildtime' => true,
        'is_preview' => false,
        'comment' => 'devforge:database:'.$database->uuid,
    ]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson('/api/devforge/v1/databases/'.$database->uuid.'/connections')
        ->assertSuccessful()
        ->assertJsonPath('data.0.application_uuid', $application->uuid)
        ->assertJsonPath('data.0.application_name', 'Demo app')
        ->assertJsonPath('data.0.env_key', 'LIBSQL_URL');
});

it('queues database deletion for the current team', function () {
    Queue::fake();

    $database = StandaloneLibsql::withoutEvents(fn () => StandaloneLibsql::create([
        'uuid' => fake()->uuid(),
        'name' => 'Disposable db',
        'libsql_auth_user' => 'libsql',
        'libsql_auth_token' => 'secret-token',
        'environment_id' => $this->environment->id,
        'destination_id' => $this->destination->id,
        'destination_type' => StandaloneDocker::class,
    ]));

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->deleteJson('/api/devforge/v1/databases/'.$database->uuid)
        ->assertSuccessful()
        ->assertJsonPath('data.queued', true);

    Queue::assertPushed(\App\Jobs\DeleteResourceJob::class);
});

it('accepts cuid database identifiers on backup routes', function () {
    $database = StandaloneLibsql::withoutEvents(fn () => StandaloneLibsql::create([
        'uuid' => 'xh3p62lu1pp006q3zkyocui4',
        'name' => 'Edge db',
        'libsql_auth_user' => 'libsql',
        'libsql_auth_token' => 'secret-token',
        'environment_id' => $this->environment->id,
        'destination_id' => $this->destination->id,
        'destination_type' => StandaloneDocker::class,
    ]));

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson('/api/devforge/v1/databases/'.$database->uuid.'/backups')
        ->assertSuccessful()
        ->assertJsonPath('meta.supports_backups', false)
        ->assertJsonCount(0, 'data');
});
