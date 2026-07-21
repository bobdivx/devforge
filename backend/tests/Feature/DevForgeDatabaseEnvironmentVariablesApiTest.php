<?php

use App\Models\Environment;
use App\Models\EnvironmentVariable;
use App\Models\Project;
use App\Models\Server;
use App\Models\StandaloneDocker;
use App\Models\StandalonePostgresql;
use App\Models\Team;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;

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
    $this->database = StandalonePostgresql::factory()->create([
        'name' => 'Env db',
        'environment_id' => $this->environment->id,
        'destination_id' => $this->destination->id,
        'destination_type' => StandaloneDocker::class,
    ]);
});

it('lists database environment variables with masked values', function () {
    $this->database->environment_variables()->create([
        'key' => 'POSTGRES_DB',
        'value' => 'secret-db',
        'is_runtime' => true,
        'is_buildtime' => false,
    ]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson("/api/devforge/v1/databases/{$this->database->uuid}/environment-variables")
        ->assertSuccessful()
        ->assertJsonPath('data.0.key', 'POSTGRES_DB')
        ->assertJsonPath('data.0.value', '********')
        ->assertJsonPath('data.0.has_value', true)
        ->assertJsonCount(1, 'data');
});

it('creates updates and deletes an editable database environment variable', function () {
    $createResponse = $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson("/api/devforge/v1/databases/{$this->database->uuid}/environment-variables", [
            'key' => 'CUSTOM_FLAG',
            'value' => 'secret-token',
            'comment' => 'Flag custom',
            'is_runtime' => true,
        ]);

    $createResponse
        ->assertCreated()
        ->assertJsonPath('data.key', 'CUSTOM_FLAG')
        ->assertJsonPath('data.comment', 'Flag custom')
        ->assertJsonPath('data.is_editable', true);

    $envUuid = $createResponse->json('data.uuid');

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->putJson("/api/devforge/v1/databases/{$this->database->uuid}/environment-variables/{$envUuid}", [
            'value' => 'updated-token',
            'comment' => 'Flag mis à jour',
        ])
        ->assertSuccessful()
        ->assertJsonPath('data.comment', 'Flag mis à jour');

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->deleteJson("/api/devforge/v1/databases/{$this->database->uuid}/environment-variables/{$envUuid}")
        ->assertSuccessful();

    expect(EnvironmentVariable::query()->where('uuid', $envUuid)->exists())->toBeFalse();
});

it('reveals a database environment variable value', function () {
    $variable = $this->database->environment_variables()->create([
        'key' => 'REVEAL_ME',
        'value' => 'plain-secret',
        'is_runtime' => true,
    ]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson("/api/devforge/v1/databases/{$this->database->uuid}/environment-variables/{$variable->uuid}/reveal")
        ->assertSuccessful()
        ->assertJsonPath('data.value', 'plain-secret');
});

it('returns the database deploy webhook url', function () {
    $url = $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson("/api/devforge/v1/databases/{$this->database->uuid}/webhooks")
        ->assertSuccessful()
        ->json('data.deploy_webhook_url');

    expect($url)->toContain((string) $this->database->uuid);
});

it('scopes database environment variables to the current team', function () {
    $otherTeam = Team::factory()->create();
    $otherServer = Server::factory()->create(['team_id' => $otherTeam->id]);
    $otherDestination = $otherServer->standaloneDockers()->firstOrFail();
    $otherProject = Project::factory()->create(['team_id' => $otherTeam->id]);
    $otherEnvironment = Environment::factory()->create(['project_id' => $otherProject->id]);
    $otherDatabase = StandalonePostgresql::factory()->create([
        'environment_id' => $otherEnvironment->id,
        'destination_id' => $otherDestination->id,
        'destination_type' => StandaloneDocker::class,
    ]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson("/api/devforge/v1/databases/{$otherDatabase->uuid}/environment-variables")
        ->assertNotFound();
});
