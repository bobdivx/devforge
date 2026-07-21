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
        'name' => 'Limits app',
        'environment_id' => $this->environment->id,
        'destination_id' => $this->destination->id,
        'destination_type' => StandaloneDocker::class,
        'limits_cpus' => '1',
        'limits_cpuset' => null,
        'limits_cpu_shares' => 1024,
        'limits_memory' => '512m',
        'limits_memory_swap' => '0',
        'limits_memory_reservation' => '0',
        'limits_memory_swappiness' => 60,
    ]);
});

it('returns application resource limits', function () {
    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson("/api/devforge/v1/applications/{$this->application->uuid}/resource-limits")
        ->assertSuccessful()
        ->assertJsonPath('data.limits_cpus', '1')
        ->assertJsonPath('data.limits_memory', '512m')
        ->assertJsonPath('data.limits_cpu_shares', 1024)
        ->assertJsonPath('data.limits_memory_swappiness', 60);
});

it('updates application resource limits', function () {
    $this->actingAs($this->user)
        ->withSession($this->session)
        ->putJson("/api/devforge/v1/applications/{$this->application->uuid}/resource-limits", [
            'limits_cpus' => '0.5',
            'limits_cpuset' => '0,1',
            'limits_cpu_shares' => 512,
            'limits_memory' => '256m',
            'limits_memory_swap' => '512m',
            'limits_memory_reservation' => '128m',
            'limits_memory_swappiness' => 40,
        ])
        ->assertSuccessful()
        ->assertJsonPath('data.limits_cpus', '0.5')
        ->assertJsonPath('data.limits_cpuset', '0,1')
        ->assertJsonPath('data.limits_memory', '256m')
        ->assertJsonPath('data.limits_memory_swappiness', 40);

    $fresh = $this->application->fresh();

    expect($fresh->limits_cpus)->toBe('0.5')
        ->and($fresh->limits_memory)->toBe('256m')
        ->and((int) $fresh->limits_cpu_shares)->toBe(512);
});

it('rejects invalid memory limit format', function () {
    $this->actingAs($this->user)
        ->withSession($this->session)
        ->putJson("/api/devforge/v1/applications/{$this->application->uuid}/resource-limits", [
            'limits_memory' => '256mb',
        ])
        ->assertStatus(422);
});

it('scopes application resource limits to the current team', function () {
    $otherTeam = Team::factory()->create();
    $otherServer = Server::factory()->create(['team_id' => $otherTeam->id]);
    $otherDestination = $otherServer->standaloneDockers()->firstOrFail();
    $otherProject = Project::factory()->create(['team_id' => $otherTeam->id]);
    $otherEnvironment = Environment::factory()->create(['project_id' => $otherProject->id]);
    $otherApplication = Application::factory()->create([
        'environment_id' => $otherEnvironment->id,
        'destination_id' => $otherDestination->id,
        'destination_type' => StandaloneDocker::class,
    ]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson("/api/devforge/v1/applications/{$otherApplication->uuid}/resource-limits")
        ->assertNotFound();
});
