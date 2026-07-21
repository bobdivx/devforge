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
        'name' => 'Advanced app',
        'environment_id' => $this->environment->id,
        'destination_id' => $this->destination->id,
        'destination_type' => StandaloneDocker::class,
        'max_restart_count' => 10,
    ]);
});

it('returns application advanced settings', function () {
    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson("/api/devforge/v1/applications/{$this->application->uuid}/advanced")
        ->assertSuccessful()
        ->assertJsonPath('data.max_restart_count', 10)
        ->assertJsonPath('data.capabilities.dockercompose', false)
        ->assertJsonStructure([
            'data' => [
                'disable_build_cache',
                'inject_build_args_to_dockerfile',
                'is_force_https_enabled',
                'is_gzip_enabled',
                'is_log_drain_enabled',
                'stop_grace_period',
                'capabilities' => [
                    'git_based',
                    'dockercompose',
                    'log_drain_server',
                ],
            ],
        ]);
});

it('updates application advanced settings', function () {
    $this->actingAs($this->user)
        ->withSession($this->session)
        ->putJson("/api/devforge/v1/applications/{$this->application->uuid}/advanced", [
            'disable_build_cache' => true,
            'is_git_lfs_enabled' => true,
            'is_force_https_enabled' => true,
            'max_restart_count' => 5,
            'stop_grace_period' => 30,
        ])
        ->assertSuccessful()
        ->assertJsonPath('data.disable_build_cache', true)
        ->assertJsonPath('data.is_git_lfs_enabled', true)
        ->assertJsonPath('data.is_force_https_enabled', true)
        ->assertJsonPath('data.max_restart_count', 5)
        ->assertJsonPath('data.stop_grace_period', 30);

    $fresh = $this->application->fresh(['settings']);

    expect((bool) $fresh->settings->disable_build_cache)->toBeTrue()
        ->and((bool) $fresh->settings->is_git_lfs_enabled)->toBeTrue()
        ->and((bool) $fresh->settings->is_force_https_enabled)->toBeTrue()
        ->and((int) $fresh->max_restart_count)->toBe(5)
        ->and((int) $fresh->settings->stop_grace_period)->toBe(30);
});

it('rejects log drain when server does not support it', function () {
    $this->actingAs($this->user)
        ->withSession($this->session)
        ->putJson("/api/devforge/v1/applications/{$this->application->uuid}/advanced", [
            'is_log_drain_enabled' => true,
        ])
        ->assertStatus(422)
        ->assertJsonValidationErrors(['is_log_drain_enabled']);
});

it('rejects invalid stop grace period', function () {
    $this->actingAs($this->user)
        ->withSession($this->session)
        ->putJson("/api/devforge/v1/applications/{$this->application->uuid}/advanced", [
            'stop_grace_period' => MAX_STOP_GRACE_PERIOD_SECONDS + 1,
        ])
        ->assertStatus(422);
});

it('scopes application advanced settings to the current team', function () {
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
        ->getJson("/api/devforge/v1/applications/{$otherApplication->uuid}/advanced")
        ->assertNotFound();
});
