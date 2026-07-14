<?php

use App\Jobs\Agent\RunAgentJob;
use App\Models\AiAgent;
use App\Models\AiAgentRun;
use App\Models\AiProviderConfig;
use App\Models\Application;
use App\Models\ApplicationDeploymentQueue;
use App\Models\Environment;
use App\Models\Project;
use App\Models\Server;
use App\Models\StandaloneDocker;
use App\Models\User;
use App\Services\DevForge\Agent\DeploymentBuildAgentDispatcher;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Queue;

uses(RefreshDatabase::class);

beforeEach(function () {
    config()->set('devforge.agents_enabled', true);
    config()->set('devforge.agents_monitor_build_enabled', true);
    config()->set('devforge.agents_per_deployment_max_runs', 0);

    $this->user = User::factory()->create();
    $this->team = $this->user->teams()->firstOrFail();
    $server = Server::factory()->create(['team_id' => $this->team->id]);
    $destination = $server->standaloneDockers()->firstOrFail();
    $project = Project::factory()->create(['team_id' => $this->team->id]);
    $environment = Environment::factory()->create(['project_id' => $project->id]);
    $this->application = Application::factory()->create([
        'environment_id' => $environment->id,
        'destination_id' => $destination->id,
        'destination_type' => StandaloneDocker::class,
    ]);
    $this->provider = AiProviderConfig::factory()->create(['team_id' => $this->team->id]);
});

it('dispatches a devforge agent when a webhook build starts', function () {
    Queue::fake();

    $agent = AiAgent::factory()->create([
        'team_id' => $this->team->id,
        'type' => 'devforge',
        'provider_config_id' => $this->provider->id,
        'schedule_minutes' => 0,
    ]);

    $deployment = ApplicationDeploymentQueue::create([
        'application_id' => $this->application->id,
        'deployment_uuid' => 'webhook-build-uuid',
        'status' => 'in_progress',
        'pull_request_id' => 0,
        'is_webhook' => true,
        'commit' => 'abc123',
    ]);

    app(DeploymentBuildAgentDispatcher::class)->dispatch(
        application: $this->application,
        deploymentUuid: 'webhook-build-uuid',
        deploymentQueue: $deployment,
    );

    Queue::assertPushed(RunAgentJob::class, function (RunAgentJob $job) use ($agent): bool {
        return $job->agent->is($agent)
            && $job->trigger === 'event'
            && ($job->context['event'] ?? null) === 'deployment_build_started'
            && ($job->context['deployment_uuid'] ?? null) === 'webhook-build-uuid';
    });
});

it('dispatches a devforge agent when a manual deployment starts', function () {
    Queue::fake();

    $agent = AiAgent::factory()->create([
        'team_id' => $this->team->id,
        'type' => 'devforge',
        'provider_config_id' => $this->provider->id,
        'schedule_minutes' => 0,
    ]);

    $deployment = ApplicationDeploymentQueue::create([
        'application_id' => $this->application->id,
        'deployment_uuid' => 'manual-build-uuid',
        'status' => 'in_progress',
        'pull_request_id' => 0,
        'is_webhook' => false,
    ]);

    app(DeploymentBuildAgentDispatcher::class)->dispatch(
        application: $this->application,
        deploymentUuid: 'manual-build-uuid',
        deploymentQueue: $deployment,
    );

    Queue::assertPushed(RunAgentJob::class, function (RunAgentJob $job) use ($agent): bool {
        return $job->agent->is($agent)
            && $job->trigger === 'event'
            && ($job->context['event'] ?? null) === 'deployment_build_started'
            && ($job->context['deployment_uuid'] ?? null) === 'manual-build-uuid'
            && ($job->context['trigger_source'] ?? null) === 'manual';
    });
});

it('dispatches a deployment agent when a manual deployment starts', function () {
    Queue::fake();

    $agent = AiAgent::factory()->deployment()->create([
        'team_id' => $this->team->id,
        'provider_config_id' => $this->provider->id,
        'schedule_minutes' => 10,
    ]);

    $deployment = ApplicationDeploymentQueue::create([
        'application_id' => $this->application->id,
        'deployment_uuid' => 'deployment-agent-build-uuid',
        'status' => 'in_progress',
        'pull_request_id' => 0,
        'is_webhook' => false,
    ]);

    app(DeploymentBuildAgentDispatcher::class)->dispatch(
        application: $this->application,
        deploymentUuid: 'deployment-agent-build-uuid',
        deploymentQueue: $deployment,
    );

    Queue::assertPushed(RunAgentJob::class, function (RunAgentJob $job) use ($agent): bool {
        return $job->agent->is($agent)
            && $job->trigger === 'event'
            && ($job->context['event'] ?? null) === 'deployment_build_started';
    });
});

it('prefers a deployment agent scoped to the application', function () {
    Queue::fake();

    AiAgent::factory()->devforge()->create([
        'team_id' => $this->team->id,
        'provider_config_id' => $this->provider->id,
    ]);

    $deploymentAgent = AiAgent::factory()->deployment()->create([
        'team_id' => $this->team->id,
        'provider_config_id' => $this->provider->id,
        'resource_uuid' => $this->application->uuid,
    ]);

    $deployment = ApplicationDeploymentQueue::create([
        'application_id' => $this->application->id,
        'deployment_uuid' => 'scoped-build-uuid',
        'status' => 'in_progress',
        'pull_request_id' => 0,
        'is_webhook' => true,
    ]);

    app(DeploymentBuildAgentDispatcher::class)->dispatch(
        application: $this->application,
        deploymentUuid: 'scoped-build-uuid',
        deploymentQueue: $deployment,
    );

    Queue::assertPushed(RunAgentJob::class, fn (RunAgentJob $job): bool => $job->agent->is($deploymentAgent));
});

it('does not dispatch devforge agents for restart-only deployments', function () {
    Queue::fake();

    AiAgent::factory()->create([
        'team_id' => $this->team->id,
        'type' => 'devforge',
        'provider_config_id' => $this->provider->id,
    ]);

    $deployment = ApplicationDeploymentQueue::create([
        'application_id' => $this->application->id,
        'deployment_uuid' => 'restart-only-uuid',
        'status' => 'in_progress',
        'pull_request_id' => 0,
        'is_webhook' => false,
        'restart_only' => true,
    ]);

    app(DeploymentBuildAgentDispatcher::class)->dispatch(
        application: $this->application,
        deploymentUuid: 'restart-only-uuid',
        deploymentQueue: $deployment,
    );

    Queue::assertNothingPushed();
});

it('does not dispatch twice for the same webhook build', function () {
    Queue::fake();

    $agent = AiAgent::factory()->create([
        'team_id' => $this->team->id,
        'type' => 'devforge',
        'provider_config_id' => $this->provider->id,
    ]);

    AiAgentRun::factory()->create([
        'agent_id' => $agent->id,
        'trigger' => 'event',
        'logs' => '[07:00:00] Contexte événement: {"event":"deployment_build_started","deployment_uuid":"duplicate-build"}',
    ]);

    $deployment = ApplicationDeploymentQueue::create([
        'application_id' => $this->application->id,
        'deployment_uuid' => 'duplicate-build',
        'status' => 'in_progress',
        'pull_request_id' => 0,
        'is_webhook' => true,
    ]);

    app(DeploymentBuildAgentDispatcher::class)->dispatch(
        application: $this->application,
        deploymentUuid: 'duplicate-build',
        deploymentQueue: $deployment,
    );

    Queue::assertNothingPushed();
});

it('dispatches a devforge agent when a build completes successfully', function () {
    Queue::fake();

    $agent = AiAgent::factory()->create([
        'team_id' => $this->team->id,
        'type' => 'devforge',
        'provider_config_id' => $this->provider->id,
        'schedule_minutes' => 0,
    ]);

    $deployment = ApplicationDeploymentQueue::create([
        'application_id' => $this->application->id,
        'deployment_uuid' => 'completed-build-uuid',
        'status' => 'finished',
        'pull_request_id' => 0,
        'is_webhook' => true,
        'commit' => 'def456',
    ]);

    app(DeploymentBuildAgentDispatcher::class)->dispatchCompleted(
        application: $this->application,
        deploymentUuid: 'completed-build-uuid',
        deploymentQueue: $deployment,
    );

    Queue::assertPushed(RunAgentJob::class, function (RunAgentJob $job) use ($agent): bool {
        return $job->agent->is($agent)
            && $job->trigger === 'event'
            && ($job->context['event'] ?? null) === 'deployment_build_completed'
            && ($job->context['deployment_uuid'] ?? null) === 'completed-build-uuid';
    });
});

it('allows build completed dispatch after build started for the same deployment', function () {
    Queue::fake();

    $agent = AiAgent::factory()->create([
        'team_id' => $this->team->id,
        'type' => 'devforge',
        'provider_config_id' => $this->provider->id,
    ]);

    AiAgentRun::factory()->create([
        'agent_id' => $agent->id,
        'trigger' => 'event',
        'logs' => '[07:00:00] Contexte événement: {"event":"deployment_build_started","deployment_uuid":"same-build-uuid"}',
    ]);

    $deployment = ApplicationDeploymentQueue::create([
        'application_id' => $this->application->id,
        'deployment_uuid' => 'same-build-uuid',
        'status' => 'finished',
        'pull_request_id' => 0,
        'is_webhook' => true,
    ]);

    app(DeploymentBuildAgentDispatcher::class)->dispatchCompleted(
        application: $this->application,
        deploymentUuid: 'same-build-uuid',
        deploymentQueue: $deployment,
    );

    Queue::assertPushed(RunAgentJob::class);
});

it('does not dispatch build monitor when per deployment limit is one', function () {
    config()->set('devforge.agents_per_deployment_max_runs', 1);

    Queue::fake();

    AiAgent::factory()->create([
        'team_id' => $this->team->id,
        'type' => 'devforge',
        'provider_config_id' => $this->provider->id,
    ]);

    $deployment = ApplicationDeploymentQueue::create([
        'application_id' => $this->application->id,
        'deployment_uuid' => 'quota-save-build',
        'status' => 'in_progress',
        'pull_request_id' => 0,
        'is_webhook' => true,
    ]);

    app(DeploymentBuildAgentDispatcher::class)->dispatch(
        application: $this->application,
        deploymentUuid: 'quota-save-build',
        deploymentQueue: $deployment,
    );

    Queue::assertNothingPushed();
});
