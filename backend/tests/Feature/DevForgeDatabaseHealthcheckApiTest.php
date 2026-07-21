<?php

use App\Models\Environment;
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
        'name' => 'Health db',
        'environment_id' => $this->environment->id,
        'destination_id' => $this->destination->id,
        'destination_type' => StandaloneDocker::class,
        'health_check_enabled' => true,
        'health_check_interval' => 15,
        'health_check_timeout' => 5,
        'health_check_retries' => 5,
        'health_check_start_period' => 5,
    ]);
});

it('returns database healthcheck settings', function () {
    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson("/api/devforge/v1/databases/{$this->database->uuid}/healthcheck")
        ->assertSuccessful()
        ->assertJsonPath('data.health_check_enabled', true)
        ->assertJsonPath('data.health_check_interval', 15)
        ->assertJsonPath('data.probe_label', 'psql — SELECT 1')
        ->assertJsonPath('data.restart_required', false);
});

it('updates database healthcheck settings', function () {
    $this->actingAs($this->user)
        ->withSession($this->session)
        ->putJson("/api/devforge/v1/databases/{$this->database->uuid}/healthcheck", [
            'health_check_enabled' => false,
            'health_check_interval' => 30,
            'health_check_timeout' => 10,
            'health_check_retries' => 3,
            'health_check_start_period' => 0,
        ])
        ->assertSuccessful()
        ->assertJsonPath('data.health_check_enabled', false)
        ->assertJsonPath('data.health_check_interval', 30)
        ->assertJsonPath('data.health_check_timeout', 10)
        ->assertJsonPath('data.health_check_retries', 3)
        ->assertJsonPath('data.health_check_start_period', 0)
        ->assertJsonPath('data.restart_required', true);

    $fresh = $this->database->fresh();

    expect($fresh->health_check_enabled)->toBeFalse()
        ->and($fresh->health_check_interval)->toBe(30)
        ->and($fresh->health_check_timeout)->toBe(10);
});

it('rejects invalid healthcheck intervals', function () {
    $this->actingAs($this->user)
        ->withSession($this->session)
        ->putJson("/api/devforge/v1/databases/{$this->database->uuid}/healthcheck", [
            'health_check_interval' => 0,
        ])
        ->assertStatus(422);
});

it('scopes database healthcheck to the current team', function () {
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
        ->getJson("/api/devforge/v1/databases/{$otherDatabase->uuid}/healthcheck")
        ->assertNotFound();
});
