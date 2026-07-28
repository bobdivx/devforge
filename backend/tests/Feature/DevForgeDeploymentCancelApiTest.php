<?php

use App\Enums\ApplicationDeploymentStatus;
use App\Models\Application;
use App\Models\ApplicationDeploymentQueue;
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
    $this->server = Server::factory()->create(['team_id' => $this->team->id]);
    $this->destination = $this->server->standaloneDockers()->firstOrFail();
    $this->project = Project::factory()->create(['team_id' => $this->team->id]);
    $this->environment = Environment::factory()->create(['project_id' => $this->project->id]);
    $this->application = Application::factory()->create([
        'environment_id' => $this->environment->id,
        'destination_id' => $this->destination->id,
        'destination_type' => StandaloneDocker::class,
        'status' => 'running',
    ]);
});

function cancelableDeployment(Application $application, Server $server, string $uuid, string $status): ApplicationDeploymentQueue
{
    return ApplicationDeploymentQueue::create([
        'application_id' => $application->id,
        'deployment_uuid' => $uuid,
        'server_id' => $server->id,
        'status' => $status,
        'pull_request_id' => 0,
        'commit' => 'HEAD',
    ]);
}

it('cancels a queued deployment via DevForge API', function () {
    $deployment = cancelableDeployment(
        $this->application,
        $this->server,
        'queued-to-cancel',
        ApplicationDeploymentStatus::QUEUED->value,
    );

    $response = $this->actingAs($this->user)
        ->withSession(['currentTeam' => $this->team])
        ->postJson('/api/devforge/v1/deployments/queued-to-cancel/cancel');

    $response
        ->assertSuccessful()
        ->assertJsonPath('data.uuid', 'queued-to-cancel')
        ->assertJsonPath('data.status', ApplicationDeploymentStatus::CANCELLED_BY_USER->value);

    $deployment->refresh();
    expect($deployment->status)->toBe(ApplicationDeploymentStatus::CANCELLED_BY_USER->value);
});

it('cancels an in-progress deployment via DevForge API', function () {
    cancelableDeployment(
        $this->application,
        $this->server,
        'in-progress-to-cancel',
        ApplicationDeploymentStatus::IN_PROGRESS->value,
    );

    $response = $this->actingAs($this->user)
        ->withSession(['currentTeam' => $this->team])
        ->postJson('/api/devforge/v1/deployments/in-progress-to-cancel/cancel');

    $response
        ->assertSuccessful()
        ->assertJsonPath('data.status', ApplicationDeploymentStatus::CANCELLED_BY_USER->value);
});

it('rejects cancelling a finished deployment', function () {
    cancelableDeployment(
        $this->application,
        $this->server,
        'already-finished',
        ApplicationDeploymentStatus::FINISHED->value,
    );

    $this->actingAs($this->user)
        ->withSession(['currentTeam' => $this->team])
        ->postJson('/api/devforge/v1/deployments/already-finished/cancel')
        ->assertStatus(422);
});

it('returns 404 for unknown deployment uuid', function () {
    $this->actingAs($this->user)
        ->withSession(['currentTeam' => $this->team])
        ->postJson('/api/devforge/v1/deployments/missing-uuid/cancel')
        ->assertNotFound();
});

it('does not cancel deployments owned by another team', function () {
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

    cancelableDeployment(
        $otherApplication,
        $otherServer,
        'other-team-queued',
        ApplicationDeploymentStatus::QUEUED->value,
    );

    $this->actingAs($this->user)
        ->withSession(['currentTeam' => $this->team])
        ->postJson('/api/devforge/v1/deployments/other-team-queued/cancel')
        ->assertNotFound();
});
