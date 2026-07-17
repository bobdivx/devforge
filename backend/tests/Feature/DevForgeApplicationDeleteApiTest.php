<?php

use App\Jobs\DeleteResourceJob;
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
    ]);
});

it('queues application deletion', function () {
    Queue::fake();

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->deleteJson("/api/devforge/v1/applications/{$this->application->uuid}")
        ->assertSuccessful()
        ->assertJsonPath('data.queued', true);

    Queue::assertPushed(DeleteResourceJob::class, function (DeleteResourceJob $job): bool {
        return $job->resource->is($this->application);
    });
});
