<?php

use App\Models\Application;
use App\Models\ApplicationSetting;
use App\Models\Environment;
use App\Models\Project;
use App\Models\Server;
use App\Models\Service;
use App\Models\StandaloneDocker;
use App\Models\Team;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

beforeEach(function () {
    $this->team = Team::factory()->create();
    $this->user = User::factory()->create();
    $this->team->members()->attach($this->user->id, ['role' => 'admin']);
    $this->actingAs($this->user);
    session(['currentTeam' => ['id' => $this->team->id]]);

    $this->server = Server::factory()->create(['team_id' => $this->team->id]);
    $this->destination = StandaloneDocker::where('server_id', $this->server->id)->first();
    $this->project = Project::factory()->create(['team_id' => $this->team->id]);
    $this->environment = Environment::factory()->create(['project_id' => $this->project->id]);
});

test('docker containers endpoint returns containers list or functional status', function () {
    $response = $this->getJson(route('docker.containers'));
    $response->assertOk();
    $response->assertJsonStructure([
        'data',
        'meta',
    ]);
});

test('docker images endpoint returns applications and services', function () {
    $application = Application::factory()->create([
        'environment_id' => $this->environment->id,
        'destination_id' => $this->destination->id,
        'destination_type' => StandaloneDocker::class,
        'build_pack' => 'dockerimage',
        'docker_registry_image_name' => 'nginx',
        'docker_registry_image_tag' => 'alpine',
    ]);

    ApplicationSetting::factory()->create([
        'application_id' => $application->id,
        'is_image_auto_update_enabled' => true,
    ]);

    $service = Service::factory()->create([
        'environment_id' => $this->environment->id,
        'server_id' => $this->server->id,
        'is_image_auto_update_enabled' => false,
    ]);

    $response = $this->getJson(route('docker.images'));
    $response->assertOk();
    $response->assertJsonFragment(['name' => $application->name]);
    $response->assertJsonFragment(['name' => $service->name]);
    $response->assertJsonFragment(['is_image_auto_update_enabled' => true]);
});

test('docker auto update toggle endpoint updates setting', function () {
    $application = Application::factory()->create([
        'environment_id' => $this->environment->id,
        'destination_id' => $this->destination->id,
        'destination_type' => StandaloneDocker::class,
        'build_pack' => 'dockerimage',
        'docker_registry_image_name' => 'redis',
        'docker_registry_image_tag' => 'alpine',
    ]);

    ApplicationSetting::factory()->create([
        'application_id' => $application->id,
        'is_image_auto_update_enabled' => false,
    ]);

    $response = $this->putJson(route('docker.images.auto-update'), [
        'type' => 'application',
        'uuid' => $application->uuid,
        'is_image_auto_update_enabled' => true,
    ]);

    $response->assertOk();
    expect($application->fresh()->settings->is_image_auto_update_enabled)->toBeTrue();
});

test('docker container action rejects invalid container identifiers', function () {
    $response = $this->postJson(route('docker.containers.action', [
        'serverUuid' => $this->server->uuid,
        'containerId' => '; rm -rf / ;',
        'action' => 'restart',
    ]));

    $response->assertStatus(422);
});
