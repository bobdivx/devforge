<?php

use App\Jobs\ScheduledTaskJob;
use App\Models\Application;
use App\Models\Environment;
use App\Models\Project;
use App\Models\ScheduledTask;
use App\Models\Server;
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
    $this->application = Application::factory()->create([
        'name' => 'Tasks app',
        'environment_id' => $this->environment->id,
        'destination_id' => $this->destination->id,
        'destination_type' => StandaloneDocker::class,
        'git_repository' => 'acme/demo-app',
        'git_branch' => 'main',
    ]);
});

it('lists creates updates and deletes application scheduled tasks', function () {
    $createResponse = $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson("/api/devforge/v1/applications/{$this->application->uuid}/scheduled-tasks", [
            'name' => 'Daily cleanup',
            'command' => 'php artisan cache:clear',
            'frequency' => 'daily',
            'timeout' => 120,
            'enabled' => true,
        ]);

    $createResponse
        ->assertCreated()
        ->assertJsonPath('data.name', 'Daily cleanup')
        ->assertJsonPath('data.frequency', 'daily')
        ->assertJsonPath('data.enabled', true);

    $taskUuid = $createResponse->json('data.uuid');

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson("/api/devforge/v1/applications/{$this->application->uuid}/scheduled-tasks")
        ->assertSuccessful()
        ->assertJsonPath('data.0.uuid', $taskUuid)
        ->assertJsonCount(1, 'data');

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->putJson("/api/devforge/v1/applications/{$this->application->uuid}/scheduled-tasks/{$taskUuid}", [
            'enabled' => false,
            'frequency' => 'hourly',
        ])
        ->assertSuccessful()
        ->assertJsonPath('data.enabled', false)
        ->assertJsonPath('data.frequency', 'hourly');

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->deleteJson("/api/devforge/v1/applications/{$this->application->uuid}/scheduled-tasks/{$taskUuid}")
        ->assertSuccessful();

    expect(ScheduledTask::query()->where('uuid', $taskUuid)->exists())->toBeFalse();
});

it('rejects invalid cron frequency', function () {
    $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson("/api/devforge/v1/applications/{$this->application->uuid}/scheduled-tasks", [
            'name' => 'Bad cron',
            'command' => 'echo hi',
            'frequency' => 'not-a-cron',
        ])
        ->assertStatus(422);
});

it('queues an immediate scheduled task run', function () {
    Bus::fake([ScheduledTaskJob::class]);

    $task = ScheduledTask::query()->create([
        'name' => 'Run now',
        'command' => 'echo hi',
        'frequency' => 'daily',
        'timeout' => 300,
        'enabled' => true,
        'team_id' => $this->team->id,
        'application_id' => $this->application->id,
    ]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson("/api/devforge/v1/applications/{$this->application->uuid}/scheduled-tasks/{$task->uuid}/run")
        ->assertSuccessful()
        ->assertJsonPath('data.queued', true);

    Bus::assertDispatched(ScheduledTaskJob::class);
});

it('scopes scheduled tasks to the current team', function () {
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
        ->getJson("/api/devforge/v1/applications/{$otherApplication->uuid}/scheduled-tasks")
        ->assertNotFound();
});
