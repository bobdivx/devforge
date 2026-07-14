<?php

use App\Models\AiAgent;
use App\Models\AiAgentRun;
use App\Models\Team;
use App\Models\User;
use App\Services\DevForge\Agent\DeploymentAgentDispatchLimiter;

beforeEach(function () {
    $this->user = User::factory()->create();
    $this->team = $this->user->teams()->firstOrFail();
});

it('allows only failure events when max runs is one', function () {
    config()->set('devforge.agents_per_deployment_max_runs', 1);

    $limiter = app(DeploymentAgentDispatchLimiter::class);

    expect($limiter->allowedEventsForLimit(1))->toBe(['deployment_failed'])
        ->and($limiter->allows('deployment_failed', $this->team, 'dep-1'))->toBeTrue()
        ->and($limiter->allows('deployment_build_started', $this->team, 'dep-1'))->toBeFalse()
        ->and($limiter->allows('deployment_build_completed', $this->team, 'dep-1'))->toBeFalse();
});

it('blocks further runs when deployment limit is reached', function () {
    config()->set('devforge.agents_per_deployment_max_runs', 1);

    $agent = AiAgent::factory()->create(['team_id' => $this->team->id]);

    AiAgentRun::factory()->create([
        'agent_id' => $agent->id,
        'trigger' => 'event',
        'logs' => '[07:00:00] Contexte événement: {"event":"deployment_failed","deployment_uuid":"dep-limit"}',
    ]);

    $limiter = app(DeploymentAgentDispatchLimiter::class);

    expect($limiter->countRunsForDeployment($this->team, 'dep-limit'))->toBe(1)
        ->and($limiter->allows('deployment_failed', $this->team, 'dep-limit'))->toBeFalse();
});

it('allows unlimited events when max runs is zero', function () {
    config()->set('devforge.agents_per_deployment_max_runs', 0);

    $limiter = app(DeploymentAgentDispatchLimiter::class);

    expect($limiter->allows('deployment_build_started', $this->team, 'dep-open'))->toBeTrue()
        ->and($limiter->allows('deployment_build_completed', $this->team, 'dep-open'))->toBeTrue();
});

it('allows failure and build start when max runs is two', function () {
    config()->set('devforge.agents_per_deployment_max_runs', 2);

    $limiter = app(DeploymentAgentDispatchLimiter::class);

    expect($limiter->allows('deployment_build_started', $this->team, 'dep-two'))->toBeTrue()
        ->and($limiter->allows('deployment_build_completed', $this->team, 'dep-two'))->toBeFalse();
});
