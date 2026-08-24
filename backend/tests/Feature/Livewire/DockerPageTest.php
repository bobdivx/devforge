<?php

use App\Livewire\Docker\Index as DockerIndex;
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
use Livewire\Livewire;

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

test('unauthenticated user cannot access docker page', function () {
    auth()->logout();

    $response = $this->get('/docker');
    $response->assertRedirect('/login');
});

test('authenticated user can view docker page', function () {
    $response = $this->get('/docker');
    $response->assertOk();
    $response->assertSeeLivewire(DockerIndex::class);
});

test('docker page renders stats and tab navigation', function () {
    Livewire::test(DockerIndex::class)
        ->assertOk()
        ->assertSee('Docker')
        ->assertSee('Total Conteneurs')
        ->assertSee("En cours d'exécution")
        ->assertSee('Mises à jour des images');
});

test('can toggle auto update on application', function () {
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
        'is_image_auto_update_enabled' => false,
    ]);

    Livewire::test(DockerIndex::class)
        ->call('toggleAutoUpdate', 'application', $application->uuid)
        ->assertDispatched('success');

    expect($application->fresh()->settings->is_image_auto_update_enabled)->toBeTrue();
});

test('can toggle auto update on service', function () {
    $service = Service::factory()->create([
        'environment_id' => $this->environment->id,
        'server_id' => $this->server->id,
        'is_image_auto_update_enabled' => false,
    ]);

    Livewire::test(DockerIndex::class)
        ->call('toggleAutoUpdate', 'service', $service->uuid)
        ->assertDispatched('success');

    expect($service->fresh()->is_image_auto_update_enabled)->toBeTrue();
});
