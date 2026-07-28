<?php

use App\Models\Application;
use App\Models\Environment;
use App\Models\Project;
use App\Models\Server;
use App\Models\StandaloneDocker;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;

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
        'name' => 'old-app-name',
    ]);
});

it('renames an application', function () {
    $this->actingAs($this->user)
        ->withSession($this->session)
        ->patchJson("/api/devforge/v1/applications/{$this->application->uuid}", [
            'name' => 'new-app-name',
        ])
        ->assertSuccessful()
        ->assertJsonPath('data.name', 'new-app-name')
        ->assertJsonPath('data.uuid', $this->application->uuid);

    expect($this->application->fresh()->name)->toBe('new-app-name');
});

it('rejects an invalid application name', function () {
    $this->actingAs($this->user)
        ->withSession($this->session)
        ->patchJson("/api/devforge/v1/applications/{$this->application->uuid}", [
            'name' => 'ab',
        ])
        ->assertUnprocessable()
        ->assertJsonValidationErrors(['name']);

    expect($this->application->fresh()->name)->toBe('old-app-name');
});
