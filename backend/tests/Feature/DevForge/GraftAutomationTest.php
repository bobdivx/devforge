<?php

use App\Jobs\DeployGraftToAllReposJob;
use App\Models\AiAgent;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Queue;

uses(RefreshDatabase::class);

beforeEach(function () {
    config()->set('devforge.enabled', true);
    config()->set('devforge.agents_enabled', true);

    $this->user = User::factory()->create();
    $this->team = $this->user->teams()->firstOrFail();
    $this->session = ['currentTeam' => $this->team];
});

it('dispatches graft deploy-all job from session api route', function () {
    Queue::fake();

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson('/api/devforge/v1/graft/deploy-all')
        ->assertSuccessful()
        ->assertJsonPath('status', 'queued')
        ->assertJsonPath('job_dispatched', true)
        ->assertJsonPath('data.status', 'queued')
        ->assertJsonPath('data.job_dispatched', true);

    Queue::assertPushed(DeployGraftToAllReposJob::class, function ($job) {
        return $job->teamId === $this->team->id;
    });
});

it('dispatches graft deploy-all job from alias route', function () {
    Queue::fake();

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson('/api/devforge/v1/ai/graft/deploy-all')
        ->assertSuccessful()
        ->assertJsonPath('status', 'queued');

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson('/api/devforge/v1/devforge/graft/deploy-all')
        ->assertSuccessful()
        ->assertJsonPath('status', 'queued');
});

it('returns graft deployment status', function () {
    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson('/api/devforge/v1/graft/status')
        ->assertSuccessful()
        ->assertJsonPath('status', 'available')
        ->assertJsonPath('data.status', 'available');
});

it('validates repo parameter when deploying to single repo', function () {
    $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson('/api/devforge/v1/graft/deploy/invalid repo name')
        ->assertUnprocessable();

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson('/api/devforge/v1/graft/deploy/bobdivx/TeslaReports')
        ->assertSuccessful()
        ->assertJsonPath('status', 'queued')
        ->assertJsonPath('repo', 'bobdivx/TeslaReports')
        ->assertJsonPath('data.repo', 'bobdivx/TeslaReports');
});

