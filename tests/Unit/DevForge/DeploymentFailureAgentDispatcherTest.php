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
use App\Services\DevForge\Agent\DeploymentFailureAgentDispatcher;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Queue;

uses(RefreshDatabase::class);

beforeEach(function () {
    config()->set('devforge.agents_enabled', true);
    config()->set('devforge.agents_auto_fix_deployments', true);

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

it('dispatches a deployment agent when a deployment fails', function () {
    Queue::fake();

    $agent = AiAgent::factory()->deployment()->create([
        'team_id' => $this->team->id,
        'provider_config_id' => $this->provider->id,
        'resource_uuid' => $this->application->uuid,
    ]);

    $deployment = ApplicationDeploymentQueue::create([
        'application_id' => $this->application->id,
        'deployment_uuid' => 'failed-deploy-uuid',
        'status' => 'failed',
        'pull_request_id' => 0,
        'logs' => json_encode([
            ['line' => 'npm ERR! build failed', 'stderr' => true, 'timestamp' => now()->toIso8601String()],
        ]),
    ]);

    app(DeploymentFailureAgentDispatcher::class)->dispatch(
        application: $this->application,
        deploymentUuid: 'failed-deploy-uuid',
        deploymentQueue: $deployment,
    );

    Queue::assertPushed(RunAgentJob::class, function (RunAgentJob $job) use ($agent): bool {
        return $job->agent->is($agent)
            && $job->trigger === 'event'
            && ($job->context['event'] ?? null) === 'deployment_failed'
            && ($job->context['deployment_uuid'] ?? null) === 'failed-deploy-uuid';
    });
});

it('prefers a deployment agent scoped to the application', function () {
    Queue::fake();

    AiAgent::factory()->debug()->create([
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
        'deployment_uuid' => 'failed-deploy-uuid-2',
        'status' => 'failed',
        'pull_request_id' => 0,
    ]);

    app(DeploymentFailureAgentDispatcher::class)->dispatch(
        application: $this->application,
        deploymentUuid: 'failed-deploy-uuid-2',
        deploymentQueue: $deployment,
    );

    Queue::assertPushed(RunAgentJob::class, fn (RunAgentJob $job): bool => $job->agent->is($deploymentAgent));
});

it('does not dispatch twice for the same failed deployment', function () {
    Queue::fake();

    $agent = AiAgent::factory()->deployment()->create([
        'team_id' => $this->team->id,
        'provider_config_id' => $this->provider->id,
    ]);

    AiAgentRun::factory()->create([
        'agent_id' => $agent->id,
        'trigger' => 'event',
        'logs' => '[07:00:00] Contexte événement: {"event":"deployment_failed","deployment_uuid":"duplicate-failure"}',
    ]);

    $deployment = ApplicationDeploymentQueue::create([
        'application_id' => $this->application->id,
        'deployment_uuid' => 'duplicate-failure',
        'status' => 'failed',
        'pull_request_id' => 0,
    ]);

    app(DeploymentFailureAgentDispatcher::class)->dispatch(
        application: $this->application,
        deploymentUuid: 'duplicate-failure',
        deploymentQueue: $deployment,
    );

    Queue::assertNothingPushed();
});

it('does nothing when agents are disabled', function () {
    Queue::fake();
    config()->set('devforge.agents_enabled', false);

    AiAgent::factory()->deployment()->create([
        'team_id' => $this->team->id,
        'provider_config_id' => $this->provider->id,
    ]);

    $deployment = ApplicationDeploymentQueue::create([
        'application_id' => $this->application->id,
        'deployment_uuid' => 'ignored-failure',
        'status' => 'failed',
        'pull_request_id' => 0,
    ]);

    app(DeploymentFailureAgentDispatcher::class)->dispatch(
        application: $this->application,
        deploymentUuid: 'ignored-failure',
        deploymentQueue: $deployment,
    );

    Queue::assertNothingPushed();
});

it('dispatches a devforge agent when a deployment fails and no deployment agent exists', function () {
    Queue::fake();

    $agent = AiAgent::factory()->create([
        'team_id' => $this->team->id,
        'type' => 'devforge',
        'provider_config_id' => $this->provider->id,
        'resource_uuid' => $this->application->uuid,
        'schedule_minutes' => 0,
    ]);

    $deployment = ApplicationDeploymentQueue::create([
        'application_id' => $this->application->id,
        'deployment_uuid' => 'failed-devforge-uuid',
        'status' => 'failed',
        'pull_request_id' => 0,
    ]);

    app(DeploymentFailureAgentDispatcher::class)->dispatch(
        application: $this->application,
        deploymentUuid: 'failed-devforge-uuid',
        deploymentQueue: $deployment,
    );

    Queue::assertPushed(RunAgentJob::class, fn (RunAgentJob $job): bool => $job->agent->is($agent));
});

it('dispatches failure agent after build started for the same deployment', function () {
    Queue::fake();

    $agent = AiAgent::factory()->create([
        'team_id' => $this->team->id,
        'type' => 'devforge',
        'provider_config_id' => $this->provider->id,
    ]);

    AiAgentRun::factory()->create([
        'agent_id' => $agent->id,
        'trigger' => 'event',
        'logs' => '[07:00:00] Contexte événement: {"event":"deployment_build_started","deployment_uuid":"failed-after-start"}',
    ]);

    $deployment = ApplicationDeploymentQueue::create([
        'application_id' => $this->application->id,
        'deployment_uuid' => 'failed-after-start',
        'status' => 'failed',
        'pull_request_id' => 0,
    ]);

    app(DeploymentFailureAgentDispatcher::class)->dispatch(
        application: $this->application,
        deploymentUuid: 'failed-after-start',
        deploymentQueue: $deployment,
    );

    Queue::assertPushed(RunAgentJob::class, function (RunAgentJob $job): bool {
        return ($job->context['event'] ?? null) === 'deployment_failed';
    });
});
