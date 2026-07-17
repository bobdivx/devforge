<?php

use App\Models\Application;
use App\Models\Environment;
use App\Models\Project;
use App\Models\Server;
use App\Models\StandaloneDocker;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Queue;

uses(RefreshDatabase::class);

beforeEach(function () {
    config()->set('devforge.enabled', true);

    $this->user = User::factory()->create();
    $this->team = $this->user->teams()->firstOrFail();
    $this->session = ['currentTeam' => $this->team];

    $server = Server::factory()->create(['team_id' => $this->team->id]);
    $destination = $server->standaloneDockers()->firstOrFail();
    $project = Project::factory()->create(['team_id' => $this->team->id]);
    $environment = Environment::factory()->create(['project_id' => $project->id]);

    $this->application = Application::factory()->create([
        'environment_id' => $environment->id,
        'destination_id' => $destination->id,
        'destination_type' => StandaloneDocker::class,
        'build_pack' => 'nixpacks',
        'ports_exposes' => '80',
        'start_command' => null,
    ]);

    $this->application->settings()->update(['is_static' => true]);
});

it('returns runtime settings including is_static', function () {
    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson("/api/devforge/v1/applications/{$this->application->uuid}/runtime-settings")
        ->assertSuccessful()
        ->assertJsonPath('data.is_static', true)
        ->assertJsonPath('data.build_pack', 'nixpacks')
        ->assertJsonPath('data.ports_exposes', '80');
});

it('updates is_static and start_command then queues a redeploy', function () {
    Queue::fake();

    $response = $this->actingAs($this->user)
        ->withSession($this->session)
        ->putJson("/api/devforge/v1/applications/{$this->application->uuid}/runtime-settings", [
            'is_static' => false,
            'start_command' => 'npm run start',
            'ports_exposes' => '3000',
            'health_check_enabled' => true,
            'health_check_path' => '/',
            'health_check_port' => '3000',
        ])
        ->assertSuccessful()
        ->assertJsonPath('data.is_static', false)
        ->assertJsonPath('data.start_command', 'npm run start')
        ->assertJsonPath('data.ports_exposes', '3000')
        ->assertJsonPath('data.health_check_enabled', true)
        ->assertJsonPath('meta.redeploy.queued', true);

    expect($response->json('meta.redeploy.deployment_uuid'))->not->toBeEmpty();

    $this->application->refresh();
    $this->application->load('settings');

    expect($this->application->settings->is_static)->toBeFalse()
        ->and($this->application->start_command)->toBe('npm run start')
        ->and((string) $this->application->ports_exposes)->toBe('3000')
        ->and($this->application->health_check_enabled)->toBeTrue();
});

it('exposes runtime fields on core application resource', function () {
    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson("/api/devforge/v1/core/applications/{$this->application->uuid}")
        ->assertSuccessful()
        ->assertJsonPath('data.configuration.is_static', true)
        ->assertJsonPath('data.configuration.ports_exposes', '80');
});
