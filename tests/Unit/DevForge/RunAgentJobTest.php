<?php

use App\Jobs\Agent\RunAgentJob;
use App\Models\AiAgent;
use App\Models\AiAgentRun;
use App\Models\AiProviderConfig;
use App\Models\Team;
use App\Services\DevForge\Agent\AgentRunner;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

it('uses the configured agent job timeout instead of a short hard-coded value', function () {
    config()->set('devforge.agents_job_timeout', 1800);

    $team = Team::factory()->create();
    $provider = AiProviderConfig::factory()->create(['team_id' => $team->id]);
    $agent = AiAgent::factory()->create([
        'team_id' => $team->id,
        'provider_config_id' => $provider->id,
    ]);

    $job = new RunAgentJob($agent, 'event', ['event' => 'deployment_failed']);

    expect($job->timeout)->toBe(1800)
        ->and($job->tries)->toBe(1)
        ->and($job->failOnTimeout)->toBeTrue();
});

it('does not flip the agent back to error when failed() runs after the run was already recovered', function () {
    $team = Team::factory()->create();
    $provider = AiProviderConfig::factory()->create(['team_id' => $team->id]);
    $agent = AiAgent::factory()->create([
        'team_id' => $team->id,
        'provider_config_id' => $provider->id,
        'status' => 'idle',
    ]);

    $run = AiAgentRun::factory()->failed()->create([
        'agent_id' => $agent->id,
        'trigger' => 'event',
        'iterations' => 0,
        'summary' => 'Run en attente expiré (file d\'attente ou worker indisponible).',
    ]);

    $job = new RunAgentJob($agent, 'event', [], $run->id);
    $job->failed(new RuntimeException('App\Jobs\Agent\RunAgentJob has been attempted too many times.'));

    expect($agent->fresh()->status)->toBe('idle')
        ->and($run->fresh()->summary)->toBe('Run en attente expiré (file d\'attente ou worker indisponible).');
});

it('marks the pending run as failed when the runner throws before completion', function () {
    $team = Team::factory()->create();
    $provider = AiProviderConfig::factory()->create(['team_id' => $team->id]);
    $agent = AiAgent::factory()->running()->create([
        'team_id' => $team->id,
        'provider_config_id' => $provider->id,
    ]);

    $run = AiAgentRun::factory()->pending()->create([
        'agent_id' => $agent->id,
        'trigger' => 'event',
        'iterations' => 0,
    ]);

    $runner = Mockery::mock(AgentRunner::class);
    $runner->shouldReceive('run')
        ->once()
        ->andThrow(new RuntimeException('provider unavailable'));

    $job = new RunAgentJob($agent, 'event', ['event' => 'deployment_failed'], $run->id);

    expect(fn () => $job->handle($runner))->toThrow(RuntimeException::class, 'provider unavailable');

    $run->refresh();
    $agent->refresh();

    expect($run->status)->toBe('failed')
        ->and($run->summary)->toContain('provider unavailable')
        ->and($agent->status)->toBe('error');
});
