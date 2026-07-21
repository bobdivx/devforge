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
        'name' => 'Webhooks app',
        'environment_id' => $this->environment->id,
        'destination_id' => $this->destination->id,
        'destination_type' => StandaloneDocker::class,
        'source_id' => 0,
        'git_repository' => 'acme/demo-app',
        'git_branch' => 'main',
        'manual_webhook_secret_github' => 'existing-secret',
    ]);
});

it('returns application webhook urls without leaking secrets', function () {
    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson("/api/devforge/v1/applications/{$this->application->uuid}/webhooks")
        ->assertSuccessful()
        ->assertJsonPath('data.manual_webhooks_available', true)
        ->assertJsonPath('data.manual.github.secret_set', true)
        ->assertJsonMissingPath('data.manual.github.secret')
        ->assertJsonMissing(['manual_webhook_secret_github' => 'existing-secret']);
});

it('updates manual webhook secrets', function () {
    $this->actingAs($this->user)
        ->withSession($this->session)
        ->putJson("/api/devforge/v1/applications/{$this->application->uuid}/webhooks", [
            'manual_webhook_secret_gitlab' => 'gitlab-secret',
        ])
        ->assertSuccessful()
        ->assertJsonPath('data.manual.gitlab.secret_set', true);

    expect($this->application->fresh()->manual_webhook_secret_gitlab)->toBe('gitlab-secret')
        ->and($this->application->fresh()->manual_webhook_secret_github)->toBe('existing-secret');
});

it('scopes application webhooks to the current team', function () {
    $otherTeam = Team::factory()->create();
    $otherServer = Server::factory()->create(['team_id' => $otherTeam->id]);
    $otherDestination = $otherServer->standaloneDockers()->firstOrFail();
    $otherProject = Project::factory()->create(['team_id' => $otherTeam->id]);
    $otherEnvironment = Environment::factory()->create(['project_id' => $otherProject->id]);
    $otherApplication = Application::factory()->create([
        'environment_id' => $otherEnvironment->id,
        'destination_id' => $otherDestination->id,
        'destination_type' => StandaloneDocker::class,
        'source_id' => 0,
    ]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson("/api/devforge/v1/applications/{$otherApplication->uuid}/webhooks")
        ->assertNotFound();
});
