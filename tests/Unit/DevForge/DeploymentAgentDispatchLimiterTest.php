<?php

use App\Models\AiAgent;
use App\Models\AiAgentRun;
use App\Models\Team;
use App\Models\User;
use App\Services\DevForge\Agent\DeploymentAgentDispatchLimiter;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

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

it('ignores aborted zero-iteration runs when counting deployment quota', function () {
    config()->set('devforge.agents_per_deployment_max_runs', 1);

    $agent = AiAgent::factory()->create(['team_id' => $this->team->id]);

    AiAgentRun::factory()->failed()->create([
        'agent_id' => $agent->id,
        'trigger' => 'event',
        'iterations' => 0,
        'summary' => 'Job échoué: App\Jobs\Agent\RunAgentJob has been attempted too many times.',
        'logs' => '[07:00:00] Contexte événement: {"event":"deployment_failed","deployment_uuid":"dep-aborted"}',
        'metadata' => [
            'event' => 'deployment_failed',
            'deployment_uuid' => 'dep-aborted',
        ],
    ]);

    $limiter = app(DeploymentAgentDispatchLimiter::class);

    expect($limiter->countRunsForDeployment($this->team, 'dep-aborted'))->toBe(0)
        ->and($limiter->allows('deployment_failed', $this->team, 'dep-aborted'))->toBeTrue();
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

it('exposes a dispatch policy explaining quota vs monitor_build', function () {
    config()->set('devforge.agents_per_deployment_max_runs', 1);
    config()->set('devforge.agents_monitor_build_enabled', true);
    config()->set('devforge.agents_auto_fix_deployments', true);

    $policy = app(DeploymentAgentDispatchLimiter::class)->policy();

    expect($policy['max_runs_per_deployment'])->toBe(1)
        ->and($policy['allowed_events'])->toBe(['deployment_failed'])
        ->and($policy['build_monitoring_effective'])->toBeFalse()
        ->and($policy['summary'])->toContain('quota')
        ->and(collect($policy['skipped_events'])->pluck('reason')->unique()->all())
        ->toContain('quota_max_runs');
});

it('counts runs linked only via metadata.deployment_uuid', function () {
    config()->set('devforge.agents_per_deployment_max_runs', 1);

    $agent = AiAgent::factory()->create(['team_id' => $this->team->id]);

    AiAgentRun::factory()->create([
        'agent_id' => $agent->id,
        'trigger' => 'event',
        'logs' => null,
        'metadata' => [
            'event' => 'deployment_failed',
            'deployment_uuid' => 'dep-meta-only',
        ],
    ]);

    $limiter = app(DeploymentAgentDispatchLimiter::class);

    expect($limiter->countRunsForDeployment($this->team, 'dep-meta-only'))->toBe(1)
        ->and($limiter->allows('deployment_failed', $this->team, 'dep-meta-only'))->toBeFalse();
});
