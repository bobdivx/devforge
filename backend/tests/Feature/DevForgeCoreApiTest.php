<?php

use App\Models\Application;
use App\Models\Environment;
use App\Models\EnvironmentVariable;
use App\Models\Project;
use App\Models\Server;
use App\Models\Service;
use App\Models\StandaloneDocker;
use App\Models\StandalonePostgresql;
use App\Models\Team;
use App\Models\User;
use App\Services\DevForge\Core\CoreResourceAction;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Mockery\MockInterface;

uses(RefreshDatabase::class);

beforeEach(function () {
    config()->set('devforge.enabled', true);

    $this->user = User::factory()->create();
    $this->team = $this->user->teams()->firstOrFail();
    $this->server = Server::factory()->create([
        'name' => 'Core server',
        'ip' => '10.0.0.10',
        'team_id' => $this->team->id,
    ]);
    $this->destination = $this->server->standaloneDockers()->firstOrFail();
    $this->project = Project::factory()->create(['team_id' => $this->team->id]);
    $this->environment = Environment::factory()->create(['project_id' => $this->project->id]);
    $this->application = Application::factory()->create([
        'name' => 'Core application',
        'environment_id' => $this->environment->id,
        'destination_id' => $this->destination->id,
        'destination_type' => StandaloneDocker::class,
        'git_repository' => 'https://token:must-not-leak@github.com/example/application?access_token=must-not-leak',
        'git_branch' => 'main',
        'fqdn' => 'https://app.example.test',
        'manual_webhook_secret_github' => 'must-not-leak',
    ]);
    $this->service = Service::factory()->create([
        'name' => 'Core service',
        'environment_id' => $this->environment->id,
        'destination_id' => $this->destination->id,
        'destination_type' => StandaloneDocker::class,
        'docker_compose_raw' => 'services: {secret: {environment: [PASSWORD=must-not-leak]}}',
    ]);
    $this->database = StandalonePostgresql::withoutEvents(fn () => StandalonePostgresql::create([
        'uuid' => fake()->uuid(),
        'name' => 'Core database',
        'image' => 'postgres:17',
        'postgres_user' => 'postgres',
        'postgres_password' => 'must-not-leak',
        'postgres_db' => 'app',
        'environment_id' => $this->environment->id,
        'destination_id' => $this->destination->id,
        'destination_type' => StandaloneDocker::class,
    ]));
});

it('exposes stable summaries without internal ids or secrets', function () {
    $response = $this->actingAs($this->user)
        ->withSession(['currentTeam' => $this->team])
        ->getJson('/api/devforge/v1/core/resources');

    $response
        ->assertSuccessful()
        ->assertJsonPath('meta.count', 4)
        ->assertJsonFragment([
            'uuid' => $this->application->uuid,
            'name' => 'Core application',
            'type' => 'application',
        ])
        ->assertJsonFragment([
            'git_repository' => 'https://github.com/example/application',
        ])
        ->assertJsonFragment([
            'uuid' => $this->database->uuid,
            'engine' => 'postgresql',
            'type' => 'database',
        ])
        ->assertJsonMissingPath('data.0.id');

    $payload = $response->getContent();

    expect($payload)
        ->not->toContain('must-not-leak')
        ->not->toContain('10.0.0.10')
        ->not->toContain('"id":')
        ->not->toContain('private_key_id')
        ->not->toContain('docker_compose');
});

it('exposes the application boot sequence contract', function () {
    $this->application->update(['status' => 'starting:unknown']);

    $this->actingAs($this->user)
        ->withSession(['currentTeam' => $this->team])
        ->getJson('/api/devforge/v1/core/applications/boot-sequence')
        ->assertSuccessful()
        ->assertJsonPath('data.active', true)
        ->assertJsonPath('data.status', 'running')
        ->assertJsonPath('data.total', 1)
        ->assertJsonPath('data.items.0.uuid', $this->application->uuid)
        ->assertJsonPath('data.items.0.phase', 'waiting');
});

it('does not start deployments when polling the boot sequence', function () {
    $this->application->update(['status' => 'exited:unhealthy']);

    $this->mock(CoreResourceAction::class, function (MockInterface $mock): void {
        $mock->shouldReceive('execute')->never();
    });

    $this->actingAs($this->user)
        ->withSession(['currentTeam' => $this->team])
        ->getJson('/api/devforge/v1/core/applications/boot-sequence')
        ->assertSuccessful()
        ->assertJsonPath('data.active', true)
        ->assertJsonPath('data.items.0.phase', 'waiting');
});

it('can force-start the application boot sequence for the team', function () {
    $this->application->update(['status' => 'exited:unhealthy']);

    $this->mock(CoreResourceAction::class, function (MockInterface $mock): void {
        $mock->shouldReceive('execute')
            ->once()
            ->andReturn([
                'queued' => true,
                'deployment_uuid' => 'deploy-start-all',
                'message' => 'Application deployment request queued.',
            ]);
    });

    $this->actingAs($this->user)
        ->withSession(['currentTeam' => $this->team])
        ->postJson('/api/devforge/v1/core/applications/boot-sequence/start')
        ->assertAccepted()
        ->assertJsonPath('data.active', true)
        ->assertJsonPath('data.total', 1)
        ->assertJsonPath('data.items.0.uuid', $this->application->uuid)
        ->assertJsonPath('data.items.0.phase', 'starting');
});

it('returns list and detail contracts scoped to the current team', function () {
    $this->actingAs($this->user)
        ->withSession(['currentTeam' => $this->team])
        ->getJson('/api/devforge/v1/core/applications')
        ->assertSuccessful()
        ->assertJsonPath('meta.resource_type', 'application')
        ->assertJsonPath('meta.count', 1)
        ->assertJsonPath('data.0.uuid', $this->application->uuid)
        ->assertJsonPath('data.0.configuration.project.uuid', $this->project->uuid)
        ->assertJsonPath('data.0.configuration.environment.uuid', $this->environment->uuid)
        ->assertJsonPath('data.0.configuration.server.uuid', $this->server->uuid);

    $this->actingAs($this->user)
        ->withSession(['currentTeam' => $this->team])
        ->getJson("/api/devforge/v1/core/databases/{$this->database->uuid}")
        ->assertSuccessful()
        ->assertJsonPath('data.uuid', $this->database->uuid)
        ->assertJsonMissingPath('data.configuration.internal_db_url')
        ->assertJsonMissingPath('data.configuration.postgres_password');
});

it('includes database presentation metadata for list cards', function () {
    $this->application->environment_variables()->create([
        'key' => 'DATABASE_URL',
        'value' => $this->database->internal_db_url,
        'comment' => 'devforge:database:'.$this->database->uuid,
        'is_preview' => false,
        'is_runtime' => true,
        'is_buildtime' => true,
    ]);

    $this->actingAs($this->user)
        ->withSession(['currentTeam' => $this->team])
        ->getJson('/api/devforge/v1/core/databases')
        ->assertSuccessful()
        ->assertJsonPath('data.0.engine_label', 'PostgreSQL')
        ->assertJsonPath('data.0.connected_applications.0.application_name', 'Core application')
        ->assertJsonPath('data.0.connected_applications.0.application_uuid', $this->application->uuid);
});

it('returns not found for resources belonging to another team', function () {
    $otherTeam = Team::factory()->create();
    $otherProject = Project::factory()->create(['team_id' => $otherTeam->id]);
    $otherEnvironment = Environment::factory()->create(['project_id' => $otherProject->id]);
    $otherApplication = Application::factory()->create([
        'environment_id' => $otherEnvironment->id,
        'destination_id' => $this->destination->id,
        'destination_type' => StandaloneDocker::class,
    ]);

    $this->actingAs($this->user)
        ->withSession(['currentTeam' => $this->team])
        ->getJson("/api/devforge/v1/core/applications/{$otherApplication->uuid}")
        ->assertNotFound()
        ->assertJsonPath('message', 'Resource not found.');

    $this->actingAs($this->user)
        ->withSession(['currentTeam' => $this->team])
        ->getJson('/api/devforge/v1/core/applications')
        ->assertSuccessful()
        ->assertJsonPath('meta.count', 1)
        ->assertJsonFragment(['uuid' => $this->application->uuid])
        ->assertJsonMissing(['uuid' => $otherApplication->uuid]);
});

it('rejects a stale or foreign current team session', function () {
    $foreignTeam = Team::factory()->create();

    $this->actingAs($this->user)
        ->withSession(['currentTeam' => $foreignTeam])
        ->getJson('/api/devforge/v1/core/resources')
        ->assertStatus(409)
        ->assertJsonPath('message', 'Current team is unavailable.');
});

it('authorizes and delegates supported actions using the scoped resource', function () {
    $this->mock(CoreResourceAction::class, function (MockInterface $mock): void {
        $mock->shouldReceive('execute')
            ->once()
            ->withArgs(fn (
                Application $application,
                string $type,
                string $action,
                array $options,
            ): bool => $application->is($this->application)
                && $type === 'applications'
                && $action === 'deploy'
                && $options === ['force' => true])
            ->andReturn([
                'resource_uuid' => $this->application->uuid,
                'resource_type' => 'application',
                'action' => 'deploy',
                'queued' => true,
                'deployment_uuid' => 'deployment-test',
            ]);
    });

    $this->actingAs($this->user)
        ->withSession(['currentTeam' => $this->team])
        ->postJson("/api/devforge/v1/core/applications/{$this->application->uuid}/deploy", [
            'force' => true,
        ])
        ->assertAccepted()
        ->assertJsonPath('data.resource_uuid', $this->application->uuid)
        ->assertJsonPath('data.deployment_uuid', 'deployment-test');
});

it('exposes start and deploy for a stopped application', function () {
    $this->application->update(['status' => 'exited:unknown']);

    $this->actingAs($this->user)
        ->withSession(['currentTeam' => $this->team])
        ->getJson("/api/devforge/v1/core/applications/{$this->application->uuid}")
        ->assertSuccessful()
        ->assertJsonPath('data.status', 'exited:unknown')
        ->assertJsonPath('data.actions', ['start', 'deploy']);
});

it('does not delegate an action for another team resource', function () {
    $otherTeam = Team::factory()->create();
    $otherProject = Project::factory()->create(['team_id' => $otherTeam->id]);
    $otherEnvironment = Environment::factory()->create(['project_id' => $otherProject->id]);
    $otherApplication = Application::factory()->create([
        'environment_id' => $otherEnvironment->id,
        'destination_id' => $this->destination->id,
        'destination_type' => StandaloneDocker::class,
    ]);

    $this->mock(CoreResourceAction::class, function (MockInterface $mock): void {
        $mock->shouldNotReceive('execute');
    });

    $this->actingAs($this->user)
        ->withSession(['currentTeam' => $this->team])
        ->postJson("/api/devforge/v1/core/applications/{$otherApplication->uuid}/stop")
        ->assertNotFound();
});

it('publishes only the explicitly supported core capabilities', function () {
    $this->actingAs($this->user)
        ->withSession(['currentTeam' => $this->team])
        ->getJson('/api/devforge/v1/core/configuration')
        ->assertSuccessful()
        ->assertJsonPath('data.actions.server', [])
        ->assertJsonPath('data.actions.application', ['start', 'stop', 'restart', 'deploy'])
        ->assertJsonPath('data.database_engines', array_keys(STANDALONE_DATABASE_MODELS));
});
