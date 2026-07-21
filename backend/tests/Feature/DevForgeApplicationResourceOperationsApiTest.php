<?php

use App\Models\Application;
use App\Models\Environment;
use App\Models\Project;
use App\Models\Server;
use App\Models\StandaloneDocker;
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
    $this->application = Application::factory()->create([
        'name' => 'Clone source',
        'environment_id' => $this->environment->id,
        'destination_id' => $this->destination->id,
        'destination_type' => StandaloneDocker::class,
    ]);
});

it('returns resource operation options for an application', function () {
    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson("/api/devforge/v1/applications/{$this->application->uuid}/resource-operations")
        ->assertSuccessful()
        ->assertJsonPath('data.current_destination_uuid', $this->destination->uuid)
        ->assertJsonPath('data.current_environment_uuid', $this->environment->uuid)
        ->assertJsonStructure([
            'data' => [
                'destinations',
                'environments',
            ],
        ]);
});

it('clones an application to another destination', function () {
    $otherServer = Server::factory()->create(['team_id' => $this->team->id]);
    $otherDestination = $otherServer->standaloneDockers()->firstOrFail();

    $response = $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson("/api/devforge/v1/applications/{$this->application->uuid}/clone", [
            'destination_uuid' => $otherDestination->uuid,
            'clone_volume_data' => false,
        ])
        ->assertCreated();

    $clonedUuid = $response->json('data.uuid');
    expect($clonedUuid)->not->toBe($this->application->uuid);

    $cloned = Application::where('uuid', $clonedUuid)->first();
    expect($cloned)->not->toBeNull()
        ->and($cloned->destination_id)->toBe($otherDestination->id)
        ->and($cloned->environment_id)->toBe($this->environment->id);
});

it('moves an application to another environment', function () {
    $otherEnvironment = Environment::factory()->create([
        'project_id' => $this->project->id,
        'name' => 'staging',
    ]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->putJson("/api/devforge/v1/applications/{$this->application->uuid}/move", [
            'environment_uuid' => $otherEnvironment->uuid,
        ])
        ->assertSuccessful()
        ->assertJsonPath('data.environment_uuid', $otherEnvironment->uuid);

    expect($this->application->fresh()->environment_id)->toBe($otherEnvironment->id);
});

it('rejects move to an environment from another team', function () {
    $otherTeam = Team::factory()->create();
    $otherProject = Project::factory()->create(['team_id' => $otherTeam->id]);
    $otherEnvironment = Environment::factory()->create(['project_id' => $otherProject->id]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->putJson("/api/devforge/v1/applications/{$this->application->uuid}/move", [
            'environment_uuid' => $otherEnvironment->uuid,
        ])
        ->assertStatus(422);
});
