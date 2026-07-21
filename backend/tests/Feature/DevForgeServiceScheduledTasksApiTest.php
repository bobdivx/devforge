<?php

use App\Jobs\ScheduledTaskJob;
use App\Models\Environment;
use App\Models\Project;
use App\Models\ScheduledTask;
use App\Models\Server;
use App\Models\Service;
use App\Models\StandaloneDocker;
use App\Models\Team;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Bus;

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
    $this->service = Service::factory()->create([
        'name' => 'Tasks service',
        'environment_id' => $this->environment->id,
        'destination_id' => $this->destination->id,
        'destination_type' => StandaloneDocker::class,
    ]);
});

it('creates and lists service scheduled tasks', function () {
    $createResponse = $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson("/api/devforge/v1/services/{$this->service->uuid}/scheduled-tasks", [
            'name' => 'Service cleanup',
            'command' => 'echo clean',
            'frequency' => 'daily',
            'timeout' => 120,
        ]);

    $createResponse
        ->assertCreated()
        ->assertJsonPath('data.name', 'Service cleanup')
        ->assertJsonPath('data.frequency', 'daily');

    $taskUuid = $createResponse->json('data.uuid');

    expect(ScheduledTask::query()->where('uuid', $taskUuid)->value('service_id'))->toBe($this->service->id);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson("/api/devforge/v1/services/{$this->service->uuid}/scheduled-tasks")
        ->assertSuccessful()
        ->assertJsonPath('data.0.uuid', $taskUuid);
});

it('queues an immediate service scheduled task run', function () {
    Bus::fake([ScheduledTaskJob::class]);

    $task = ScheduledTask::query()->create([
        'name' => 'Run now',
        'command' => 'echo hi',
        'frequency' => 'daily',
        'timeout' => 300,
        'enabled' => true,
        'team_id' => $this->team->id,
        'service_id' => $this->service->id,
    ]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson("/api/devforge/v1/services/{$this->service->uuid}/scheduled-tasks/{$task->uuid}/run")
        ->assertSuccessful()
        ->assertJsonPath('data.queued', true);

    Bus::assertDispatched(ScheduledTaskJob::class);
});

it('scopes service scheduled tasks to the current team', function () {
    $otherTeam = Team::factory()->create();
    $otherServer = Server::factory()->create(['team_id' => $otherTeam->id]);
    $otherDestination = $otherServer->standaloneDockers()->firstOrFail();
    $otherProject = Project::factory()->create(['team_id' => $otherTeam->id]);
    $otherEnvironment = Environment::factory()->create(['project_id' => $otherProject->id]);
    $otherService = Service::factory()->create([
        'environment_id' => $otherEnvironment->id,
        'destination_id' => $otherDestination->id,
        'destination_type' => StandaloneDocker::class,
    ]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson("/api/devforge/v1/services/{$otherService->uuid}/scheduled-tasks")
        ->assertNotFound();
});
