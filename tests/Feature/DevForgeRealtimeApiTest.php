<?php

use App\Enums\ApplicationDeploymentStatus;
use App\Models\Application;
use App\Models\ApplicationDeploymentQueue;
use App\Models\Environment;
use App\Models\EnvironmentVariable;
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
        'name' => 'Current tenant application',
        'environment_id' => $this->environment->id,
        'destination_id' => $this->destination->id,
        'destination_type' => StandaloneDocker::class,
        'status' => 'running',
    ]);
});

function devForgeDeployment(Application $application, string $uuid, array $attributes = []): ApplicationDeploymentQueue
{
    return ApplicationDeploymentQueue::create(array_merge([
        'application_id' => $application->id,
        'deployment_uuid' => $uuid,
        'status' => ApplicationDeploymentStatus::IN_PROGRESS->value,
        'pull_request_id' => 0,
    ], $attributes));
}

it('requires an authenticated verified session for realtime contracts', function () {
    $this->getJson('/api/devforge/v1/deployments')
        ->assertUnauthorized()
        ->assertHeader('content-type', 'application/json');
});

it('lists and shows only deployments from the current session team', function () {
    $deployment = devForgeDeployment($this->application, 'current-team-deployment');

    $otherTeam = Team::factory()->create();
    $otherProject = Project::factory()->create(['team_id' => $otherTeam->id]);
    $otherEnvironment = Environment::factory()->create(['project_id' => $otherProject->id]);
    $otherApplication = Application::factory()->create(['environment_id' => $otherEnvironment->id]);
    $otherDeployment = devForgeDeployment($otherApplication, 'other-team-deployment');

    $response = $this->actingAs($this->user)
        ->withSession(['currentTeam' => $this->team])
        ->getJson('/api/devforge/v1/deployments');

    $response
        ->assertSuccessful()
        ->assertJsonPath('data.0.uuid', $deployment->deployment_uuid)
        ->assertJsonPath('meta.total', 1)
        ->assertJsonMissing(['uuid' => $otherDeployment->deployment_uuid])
        ->assertJsonMissingPath('data.0.logs')
        ->assertJsonMissingPath('data.0.application_id');

    $this->actingAs($this->user)
        ->withSession(['currentTeam' => $this->team])
        ->getJson('/api/devforge/v1/deployments/'.$otherDeployment->deployment_uuid)
        ->assertNotFound();

    $this->actingAs($this->user)
        ->withSession(['currentTeam' => $this->team])
        ->getJson('/api/devforge/v1/deployments/'.$otherDeployment->deployment_uuid.'/logs')
        ->assertNotFound();
});

it('polls deployment logs with a cursor and redacts application secrets', function () {
    EnvironmentVariable::create([
        'key' => 'API_TOKEN',
        'value' => 'super-secret-token',
        'is_preview' => false,
        'resourceable_type' => Application::class,
        'resourceable_id' => $this->application->id,
    ]);
    $deployment = devForgeDeployment($this->application, 'deployment-with-logs', [
        'logs' => json_encode([
            [
                'output' => 'first line',
                'type' => 'stdout',
                'timestamp' => now()->toISOString(),
                'hidden' => false,
                'batch' => 1,
                'order' => 1,
                'command' => null,
            ],
            [
                'output' => 'token=super-secret-token',
                'type' => 'stderr',
                'timestamp' => now()->toISOString(),
                'hidden' => false,
                'batch' => 1,
                'order' => 2,
                'command' => null,
            ],
        ], JSON_THROW_ON_ERROR),
    ]);

    $response = $this->actingAs($this->user)
        ->withSession(['currentTeam' => $this->team])
        ->getJson('/api/devforge/v1/deployments/'.$deployment->deployment_uuid.'/logs?after=1');

    $response
        ->assertSuccessful()
        ->assertJsonCount(1, 'data.items')
        ->assertJsonPath('data.items.0.cursor', 2)
        ->assertJsonPath('data.items.0.stream', 'stderr')
        ->assertJsonPath('data.next_cursor', 2)
        ->assertJsonMissing(['message' => 'token=super-secret-token']);

    expect($response->json('data.items.0.message'))->toContain(REDACTED);
});

it('returns tenant-scoped status and stable realtime metadata', function () {
    $otherTeam = Team::factory()->create();
    $otherProject = Project::factory()->create(['team_id' => $otherTeam->id]);
    $otherEnvironment = Environment::factory()->create(['project_id' => $otherProject->id]);
    Application::factory()->create([
        'name' => 'Other tenant application',
        'environment_id' => $otherEnvironment->id,
        'status' => 'stopped',
    ]);

    $status = $this->actingAs($this->user)
        ->withSession(['currentTeam' => $this->team])
        ->getJson('/api/devforge/v1/resources/status');

    $status
        ->assertSuccessful()
        ->assertJsonPath('data.applications.0.uuid', $this->application->uuid)
        ->assertJsonMissing(['name' => 'Other tenant application']);

    $this->actingAs($this->user)
        ->withSession(['currentTeam' => $this->team])
        ->getJson('/api/devforge/v1/realtime')
        ->assertSuccessful()
        ->assertJsonPath('data.channels.team.subscription', 'team.'.$this->team->id)
        ->assertJsonPath('data.channels.user.subscription', 'user.'.$this->user->id)
        ->assertJsonPath('data.capabilities.container_logs.available', false);
});

it('requires the terminal gate and returns no connection secrets', function () {
    $member = User::factory()->create();
    $this->team->members()->attach($member, ['role' => 'member']);

    $this->actingAs($member)
        ->withSession(['currentTeam' => $this->team])
        ->getJson('/api/devforge/v1/terminal/config')
        ->assertForbidden();

    $response = $this->actingAs($this->user)
        ->withSession(['currentTeam' => $this->team])
        ->getJson('/api/devforge/v1/terminal/config');

    $response
        ->assertSuccessful()
        ->assertJsonPath('data.auth.endpoint', '/terminal/auth')
        ->assertJsonPath('data.permissions.access', true)
        ->assertJsonMissingPath('data.password')
        ->assertJsonMissingPath('data.token')
        ->assertJsonMissingPath('data.private_key');

    expect($response->json('data.websocket_url'))->toEndWith('/terminal/ws');
});

it('rejects a stale or foreign current team stored in the session', function () {
    $foreignTeam = Team::factory()->create();

    $this->actingAs($this->user)
        ->getJson('/api/devforge/v1/deployments')
        ->assertStatus(409)
        ->assertJsonPath('message', 'No current team is selected.');

    $this->actingAs($this->user)
        ->withSession(['currentTeam' => $foreignTeam])
        ->getJson('/api/devforge/v1/deployments')
        ->assertForbidden()
        ->assertJsonPath('message', 'The selected team is not available.');
});
