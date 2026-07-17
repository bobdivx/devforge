<?php

use App\Jobs\Agent\RunAgentJob;
use App\Models\AiAgent;
use App\Models\AiAgentRun;
use App\Models\AiProviderConfig;
use App\Models\Team;
use App\Services\DevForge\Agent\AgentRunLauncher;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Queue;

uses(RefreshDatabase::class);

beforeEach(function () {
    Queue::fake();
});

it('queues a run and marks the agent as running immediately', function () {
    $team = Team::factory()->create();
    $provider = AiProviderConfig::factory()->create(['team_id' => $team->id]);
    $agent = AiAgent::factory()->create([
        'team_id' => $team->id,
        'provider_config_id' => $provider->id,
        'status' => 'idle',
    ]);

    $run = app(AgentRunLauncher::class)->queue($agent, 'manual');

    expect($run)->toBeInstanceOf(AiAgentRun::class)
        ->and($run->status)->toBe('pending')
        ->and($agent->fresh()->status)->toBe('running');

    Queue::assertPushed(RunAgentJob::class, function (RunAgentJob $job) use ($agent, $run) {
        return $job->agent->is($agent)
            && $job->trigger === 'manual'
            && $job->runId === $run->id;
    });
});

it('returns null when the agent is already running', function () {
    $team = Team::factory()->create();
    $provider = AiProviderConfig::factory()->create(['team_id' => $team->id]);
    $agent = AiAgent::factory()->running()->create([
        'team_id' => $team->id,
        'provider_config_id' => $provider->id,
    ]);

    AiAgentRun::factory()->running()->create(['agent_id' => $agent->id]);

    $run = app(AgentRunLauncher::class)->queue($agent, 'manual');

    expect($run)->toBeNull();
    Queue::assertNothingPushed();
});

it('stores deployment_uuid and event in run metadata for event triggers', function () {
    $team = Team::factory()->create();
    $provider = AiProviderConfig::factory()->create(['team_id' => $team->id]);
    $agent = AiAgent::factory()->create([
        'team_id' => $team->id,
        'provider_config_id' => $provider->id,
        'status' => 'idle',
    ]);

    $run = app(AgentRunLauncher::class)->queue($agent, 'event', [
        'event' => 'deployment_failed',
        'deployment_uuid' => 'deploy-meta-uuid',
        'application_uuid' => 'app-meta-uuid',
        'failure_excerpt' => [['stream' => 'stderr', 'message' => 'boom']],
    ]);

    expect($run)->toBeInstanceOf(AiAgentRun::class)
        ->and($run->metadata)->toMatchArray([
            'event' => 'deployment_failed',
            'deployment_uuid' => 'deploy-meta-uuid',
            'application_uuid' => 'app-meta-uuid',
        ]);
});

it('recovers a stale pending event run before queueing a deployment agent', function () {
    $team = Team::factory()->create();
    $provider = AiProviderConfig::factory()->create([
        'team_id' => $team->id,
        'provider' => 'ollama',
        'model' => 'auto',
        'base_url' => 'http://ollama.test',
    ]);
    $agent = AiAgent::factory()->running()->create([
        'team_id' => $team->id,
        'provider_config_id' => $provider->id,
    ]);

    AiAgentRun::factory()->create([
        'agent_id' => $agent->id,
        'status' => 'pending',
        'trigger' => 'event',
        'started_at' => null,
        'created_at' => now()->subMinutes(2),
    ]);

    $run = app(AgentRunLauncher::class)->queue($agent, 'event', [
        'event' => 'deployment_failed',
        'deployment_uuid' => 'deploy-stale-pending',
    ]);

    expect($run)->toBeInstanceOf(AiAgentRun::class)
        ->and($agent->fresh()->status)->toBe('running');

    Queue::assertPushed(RunAgentJob::class);
});
