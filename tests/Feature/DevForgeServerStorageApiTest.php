<?php

use App\Jobs\DockerCleanupJob;
use App\Models\DockerCleanupExecution;
use App\Models\Server;
use App\Models\Team;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Bus;

uses(RefreshDatabase::class);

beforeEach(function () {
    config()->set('devforge.enabled', true);

    $this->user = User::factory()->create();
    $this->team = $this->user->teams()->firstOrFail();
    $this->server = Server::factory()->create([
        'team_id' => $this->team->id,
        'name' => 'Production host',
    ]);
    $this->server->settings->update([
        'docker_cleanup_frequency' => '0 2 * * *',
        'docker_cleanup_threshold' => 75,
        'force_docker_cleanup' => false,
        'server_disk_usage_notification_threshold' => 85,
        'server_disk_usage_check_frequency' => '0 23 * * *',
    ]);
});

it('lists server storage overview for the current team only', function () {
    $otherTeam = Team::factory()->create();
    Server::factory()->create(['team_id' => $otherTeam->id, 'name' => 'Foreign host']);

    $response = $this->actingAs($this->user)
        ->withSession(['currentTeam' => $this->team])
        ->getJson('/api/devforge/v1/server-storage');

    $response
        ->assertSuccessful()
        ->assertJsonCount(1, 'data')
        ->assertJsonPath('data.0.uuid', $this->server->uuid)
        ->assertJsonPath('data.0.cleanup.docker_cleanup_threshold', 75)
        ->assertJsonPath('data.0.monitoring.server_disk_usage_notification_threshold', 85)
        ->assertJsonMissing(['name' => 'Foreign host'])
        ->assertJsonStructure(['data' => [['disk_usage_percent']]]);
});

it('can skip live disk measurement on overview', function () {
    $this->actingAs($this->user)
        ->withSession(['currentTeam' => $this->team])
        ->getJson('/api/devforge/v1/server-storage?refresh_disk=0')
        ->assertSuccessful()
        ->assertJsonPath('data.0.disk_usage_percent', null);
});

it('lists overview when the last cleanup execution has finished_at set', function () {
    DockerCleanupExecution::create([
        'server_id' => $this->server->id,
        'status' => 'failed',
        'message' => 'Server is not functional (unreachable, unusable, or disabled)',
        'finished_at' => now(),
    ]);

    $this->actingAs($this->user)
        ->withSession(['currentTeam' => $this->team])
        ->getJson('/api/devforge/v1/server-storage')
        ->assertSuccessful()
        ->assertJsonPath('data.0.last_cleanup.status', 'failed')
        ->assertJsonPath('data.0.last_cleanup.finished_at', fn ($value) => is_string($value) && $value !== '');
});

it('shows server storage detail with cleanup executions', function () {
    DockerCleanupExecution::create([
        'server_id' => $this->server->id,
        'status' => 'success',
        'message' => 'Saved 12% disk space.',
    ]);

    $this->actingAs($this->user)
        ->withSession(['currentTeam' => $this->team])
        ->getJson('/api/devforge/v1/server-storage/'.$this->server->uuid)
        ->assertSuccessful()
        ->assertJsonPath('data.uuid', $this->server->uuid)
        ->assertJsonCount(1, 'data.executions')
        ->assertJsonPath('data.executions.0.status', 'success');
});

it('accepts coolify cuid server identifiers on disk refresh route', function () {
    expect($this->server->uuid)->toMatch('/^[a-z0-9]{20,}$/');

    $this->actingAs($this->user)
        ->withSession(['currentTeam' => $this->team])
        ->postJson('/api/devforge/v1/server-storage/'.$this->server->uuid.'/disk')
        ->assertSuccessful()
        ->assertJsonStructure(['data' => ['disk_usage_percent']]);
});

it('updates docker cleanup and monitoring settings', function () {
    $response = $this->actingAs($this->user)
        ->withSession(['currentTeam' => $this->team])
        ->putJson('/api/devforge/v1/server-storage/'.$this->server->uuid, [
            'force_docker_cleanup' => true,
            'docker_cleanup_frequency' => 'hourly',
            'docker_cleanup_threshold' => 70,
            'server_disk_usage_notification_threshold' => 88,
            'server_disk_usage_check_frequency' => 'daily',
        ]);

    $response
        ->assertSuccessful()
        ->assertJsonPath('data.cleanup.force_docker_cleanup', true)
        ->assertJsonPath('data.cleanup.docker_cleanup_threshold', 70)
        ->assertJsonPath('data.monitoring.server_disk_usage_notification_threshold', 88);

    expect($this->server->settings->fresh())
        ->force_docker_cleanup->toBeTrue()
        ->docker_cleanup_threshold->toBe(70);
});

it('rejects invalid cron expressions for cleanup settings', function () {
    $this->actingAs($this->user)
        ->withSession(['currentTeam' => $this->team])
        ->putJson('/api/devforge/v1/server-storage/'.$this->server->uuid, [
            'docker_cleanup_frequency' => 'not-a-cron',
        ])
        ->assertUnprocessable()
        ->assertJsonValidationErrors(['docker_cleanup_frequency']);
});

it('dispatches manual docker cleanup jobs', function () {
    Bus::fake();

    $this->actingAs($this->user)
        ->withSession(['currentTeam' => $this->team])
        ->postJson('/api/devforge/v1/server-storage/'.$this->server->uuid.'/cleanup')
        ->assertSuccessful()
        ->assertJsonPath('data.queued', true)
        ->assertJsonPath('data.execution_id', fn ($id) => is_int($id) && $id > 0);

    Bus::assertDispatched(DockerCleanupJob::class, function (DockerCleanupJob $job): bool {
        return $job->server->is($this->server)
            && $job->manualCleanup === true
            && $job->executionId !== null;
    });

    expect(DockerCleanupExecution::query()->where('server_id', $this->server->id)->latest('id')->first())
        ->status->toBe('running');
});

it('applies aggressive cleanup settings before dispatching the job', function () {
    Bus::fake();

    $this->actingAs($this->user)
        ->withSession(['currentTeam' => $this->team])
        ->postJson('/api/devforge/v1/server-storage/'.$this->server->uuid.'/cleanup', [
            'aggressive' => true,
        ])
        ->assertSuccessful()
        ->assertJsonPath('data.aggressive', true);

    expect($this->server->settings->fresh())
        ->delete_unused_volumes->toBeTrue()
        ->delete_unused_networks->toBeTrue()
        ->disable_application_image_retention->toBeTrue()
        ->force_docker_cleanup->toBeTrue();

    Bus::assertDispatched(DockerCleanupJob::class, function (DockerCleanupJob $job): bool {
        return $job->deleteUnusedVolumes === true
            && $job->deleteUnusedNetworks === true;
    });
});

it('returns not found for servers outside the current team', function () {
    $otherTeam = Team::factory()->create();
    $foreignServer = Server::factory()->create(['team_id' => $otherTeam->id]);

    $this->actingAs($this->user)
        ->withSession(['currentTeam' => $this->team])
        ->getJson('/api/devforge/v1/server-storage/'.$foreignServer->uuid)
        ->assertNotFound();
});
