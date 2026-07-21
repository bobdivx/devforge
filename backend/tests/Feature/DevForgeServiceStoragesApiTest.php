<?php

use App\Models\Environment;
use App\Models\LocalPersistentVolume;
use App\Models\Project;
use App\Models\Server;
use App\Models\Service;
use App\Models\ServiceApplication;
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
    $this->service = Service::factory()->create([
        'name' => 'Storage service',
        'environment_id' => $this->environment->id,
        'destination_id' => $this->destination->id,
        'destination_type' => StandaloneDocker::class,
    ]);
    $this->serviceApp = ServiceApplication::factory()->create([
        'name' => 'web',
        'service_id' => $this->service->id,
    ]);
});

it('lists service storages grouped by child', function () {
    LocalPersistentVolume::create([
        'name' => $this->serviceApp->uuid.'-data',
        'mount_path' => '/data',
        'host_path' => null,
        'resource_id' => $this->serviceApp->id,
        'resource_type' => $this->serviceApp->getMorphClass(),
    ]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson("/api/devforge/v1/services/{$this->service->uuid}/storages")
        ->assertSuccessful()
        ->assertJsonPath('data.compose_managed', true)
        ->assertJsonPath('data.groups.0.child_name', 'web')
        ->assertJsonPath('data.groups.0.child_type', 'application')
        ->assertJsonPath('data.groups.0.storages.0.mount_path', '/data')
        ->assertJsonPath('data.groups.0.storages.0.read_only', true);
});

it('returns empty groups when service has no storages', function () {
    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson("/api/devforge/v1/services/{$this->service->uuid}/storages")
        ->assertSuccessful()
        ->assertJsonPath('data.groups', []);
});

it('scopes service storages to the current team', function () {
    $otherTeam = Team::factory()->create();
    $otherServer = Server::factory()->create(['team_id' => $otherTeam->id]);
    $otherDestination = $otherServer->standaloneDockers()->firstOrFail();
    $otherProject = Project::factory()->create(['team_id' => $otherTeam->id]);
    $otherEnvironment = Environment::factory()->create(['project_id' => $otherProject->id]);
    $otherService = Service::factory()->create([
        'environment_id' => $otherEnvironment->id,
        'destination_id' => $otherDestination->id,
        'destination_type' => StandaloneDocker::class,
    ]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson("/api/devforge/v1/services/{$otherService->uuid}/storages")
        ->assertNotFound();
});
