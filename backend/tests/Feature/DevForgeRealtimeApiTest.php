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

it('filters deployments by application_uuid within the current team', function () {
    $starbaseDeployment = devForgeDeployment($this->application, 'starbase-deployment', [
        'commit' => '3d299c07e2b47b62947eb9e846c065f3d1df40d1',
        'commit_message' => 'fix: support libSQL Coolify self-hosted',
        'status' => ApplicationDeploymentStatus::FINISHED->value,
    ]);

    $tesla = Application::factory()->create([
        'name' => 'TeslaSphere',
        'environment_id' => $this->environment->id,
        'destination_id' => $this->destination->id,
        'destination_type' => StandaloneDocker::class,
        'status' => 'running',
    ]);
    $teslaDeployment = devForgeDeployment($tesla, 'tesla-deployment', [
        'commit' => 'cb9759c8fdd36811f806bf861e4e7244fb6a6a5a',
        'commit_message' => 'chore: add nixpacks.toml to enforce node SSR',
        'status' => ApplicationDeploymentStatus::FINISHED->value,
    ]);

    $this->actingAs($this->user)
        ->withSession(['currentTeam' => $this->team])
        ->getJson('/api/devforge/v1/deployments?application_uuid='.$this->application->uuid)
        ->assertSuccessful()
        ->assertJsonPath('meta.total', 1)
        ->assertJsonPath('data.0.uuid', $starbaseDeployment->deployment_uuid)
        ->assertJsonPath('data.0.application.uuid', $this->application->uuid)
        ->assertJsonMissing(['uuid' => $teslaDeployment->deployment_uuid]);

    $this->actingAs($this->user)
        ->withSession(['currentTeam' => $this->team])
        ->getJson('/api/devforge/v1/deployments?application_uuid='.$tesla->uuid)
        ->assertSuccessful()
        ->assertJsonPath('meta.total', 1)
        ->assertJsonPath('data.0.uuid', $teslaDeployment->deployment_uuid)
        ->assertJsonPath('data.0.commit', 'cb9759c8fdd36811f806bf861e4e7244fb6a6a5a');
});

it('lists only queued and in-progress deployments when active=1', function () {
    $queued = devForgeDeployment($this->application, 'active-queued', [
        'status' => ApplicationDeploymentStatus::QUEUED->value,
    ]);
    $inProgress = devForgeDeployment($this->application, 'active-in-progress', [
        'status' => ApplicationDeploymentStatus::IN_PROGRESS->value,
    ]);
    $finished = devForgeDeployment($this->application, 'inactive-finished', [
        'status' => ApplicationDeploymentStatus::FINISHED->value,
    ]);

    $response = $this->actingAs($this->user)
        ->withSession(['currentTeam' => $this->team])
        ->getJson('/api/devforge/v1/deployments?active=1&per_page=50');

    $response
        ->assertSuccessful()
        ->assertJsonPath('meta.total', 2);

    $uuids = collect($response->json('data'))->pluck('uuid')->all();

    expect($uuids)
        ->toContain($queued->deployment_uuid)
        ->toContain($inProgress->deployment_uuid)
        ->not->toContain($finished->deployment_uuid);
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

it('hides debug deployment logs until debug mode is enabled on the application', function () {
    $deployment = devForgeDeployment($this->application, 'deployment-debug-logs', [
        'logs' => json_encode([
            [
                'output' => 'public line',
                'type' => 'stdout',
                'timestamp' => now()->toISOString(),
                'hidden' => false,
                'batch' => 1,
                'order' => 1,
                'command' => null,
            ],
            [
                'output' => 'docker build output',
                'type' => 'stdout',
                'timestamp' => now()->toISOString(),
                'hidden' => true,
                'batch' => 1,
                'order' => 2,
                'command' => null,
            ],
        ], JSON_THROW_ON_ERROR),
    ]);

    $this->actingAs($this->user)
        ->withSession(['currentTeam' => $this->team])
        ->getJson('/api/devforge/v1/deployments/'.$deployment->deployment_uuid.'/logs')
        ->assertSuccessful()
        ->assertJsonCount(1, 'data.items')
        ->assertJsonPath('data.items.0.message', 'public line');

    $this->application->settings->update(['is_debug_enabled' => true]);

    $this->actingAs($this->user)
        ->withSession(['currentTeam' => $this->team])
        ->getJson('/api/devforge/v1/deployments/'.$deployment->deployment_uuid.'/logs')
        ->assertSuccessful()
        ->assertJsonCount(2, 'data.items')
        ->assertJsonPath('data.items.1.hidden', true)
        ->assertJsonPath('data.items.1.message', 'docker build output');
});

it('toggles deployment debug logs for authorized users', function () {
    $deployment = devForgeDeployment($this->application, 'deployment-toggle-debug');

    expect($this->application->settings->is_debug_enabled)->toBeFalse();

    $this->actingAs($this->user)
        ->withSession(['currentTeam' => $this->team])
        ->patchJson('/api/devforge/v1/deployments/'.$deployment->deployment_uuid.'/debug-logs')
        ->assertSuccessful()
        ->assertJsonPath('data.is_debug_enabled', true);

    expect($this->application->settings->fresh()->is_debug_enabled)->toBeTrue();

    $this->actingAs($this->user)
        ->withSession(['currentTeam' => $this->team])
        ->patchJson('/api/devforge/v1/deployments/'.$deployment->deployment_uuid.'/debug-logs', [
            'enabled' => false,
        ])
        ->assertSuccessful()
        ->assertJsonPath('data.is_debug_enabled', false);
});

it('includes debug log preference on deployment payloads', function () {
    $this->application->settings->update(['is_debug_enabled' => true]);
    $deployment = devForgeDeployment($this->application, 'deployment-debug-flag');

    $this->actingAs($this->user)
        ->withSession(['currentTeam' => $this->team])
        ->getJson('/api/devforge/v1/deployments/'.$deployment->deployment_uuid)
        ->assertSuccessful()
        ->assertJsonPath('data.is_debug_enabled', true);
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

it('creates a terminal session command for an eligible server', function () {
    $privateKey = \App\Models\PrivateKey::factory()->create(['team_id' => $this->team->id]);
    $server = \App\Models\Server::factory()->create([
        'team_id' => $this->team->id,
        'private_key_id' => $privateKey->id,
    ]);
    \App\Models\ServerSetting::factory()->create([
        'server_id' => $server->id,
        'is_terminal_enabled' => true,
        'is_reachable' => true,
    ]);

    $response = $this->actingAs($this->user)
        ->withSession(['currentTeam' => $this->team])
        ->postJson('/api/devforge/v1/terminal/session', [
            'server_uuid' => $server->uuid,
        ]);

    $response
        ->assertSuccessful()
        ->assertJsonPath('data.server_uuid', $server->uuid);

    expect($response->json('data.command'))->toBeString()->not->toBe('');
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
