<?php

use App\Jobs\Agent\RunAgentJob;
use App\Models\AiAgent;
use App\Models\AiAgentRun;
use App\Models\AiProviderConfig;
use App\Models\Application;
use App\Models\ApplicationDeploymentQueue;
use App\Models\Environment;
use App\Models\EnvironmentVariable;
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

it('still dispatches failure agent when per deployment limit is one', function () {
    config()->set('devforge.agents_per_deployment_max_runs', 1);

    Queue::fake();

    $agent = AiAgent::factory()->debug()->create([
        'team_id' => $this->team->id,
        'provider_config_id' => $this->provider->id,
    ]);

    $deployment = ApplicationDeploymentQueue::create([
        'application_id' => $this->application->id,
        'deployment_uuid' => 'quota-save-failure',
        'status' => 'failed',
        'pull_request_id' => 0,
    ]);

    app(DeploymentFailureAgentDispatcher::class)->dispatch(
        application: $this->application,
        deploymentUuid: 'quota-save-failure',
        deploymentQueue: $deployment,
    );

    Queue::assertPushed(RunAgentJob::class, fn (RunAgentJob $job): bool => $job->agent->is($agent));
});

it('redispatches when the previous failure run aborted with zero iterations', function () {
    Queue::fake();

    $agent = AiAgent::factory()->deployment()->create([
        'team_id' => $this->team->id,
        'provider_config_id' => $this->provider->id,
        'status' => 'idle',
    ]);

    AiAgentRun::factory()->failed()->create([
        'agent_id' => $agent->id,
        'trigger' => 'event',
        'iterations' => 0,
        'summary' => 'Job échoué: App\Jobs\Agent\RunAgentJob has been attempted too many times.',
        'logs' => '[07:00:00] Contexte événement: {"event":"deployment_failed","deployment_uuid":"aborted-failure"}',
        'metadata' => [
            'event' => 'deployment_failed',
            'deployment_uuid' => 'aborted-failure',
        ],
    ]);

    $deployment = ApplicationDeploymentQueue::create([
        'application_id' => $this->application->id,
        'deployment_uuid' => 'aborted-failure',
        'status' => 'failed',
        'pull_request_id' => 0,
    ]);

    app(DeploymentFailureAgentDispatcher::class)->dispatch(
        application: $this->application,
        deploymentUuid: 'aborted-failure',
        deploymentQueue: $deployment,
    );

    Queue::assertPushed(RunAgentJob::class, fn (RunAgentJob $job): bool => $job->agent->is($agent));
});

it('keeps actionable npm errors in the failure excerpt instead of docker secret warnings', function () {
    Queue::fake();

    AiAgent::factory()->deployment()->create([
        'team_id' => $this->team->id,
        'provider_config_id' => $this->provider->id,
    ]);

    $noise = collect(range(1, 25))->map(fn (int $i): array => [
        'command' => null,
        'output' => ' - SecretsUsedInArgOrEnv: Do not use ARG or ENV instructions for sensitive data (ENV "SECRET_'.$i.'")',
        'type' => 'stderr',
        'timestamp' => now()->toIso8601String(),
        'hidden' => false,
        'batch' => 1,
    ])->all();

    $deployment = ApplicationDeploymentQueue::create([
        'application_id' => $this->application->id,
        'deployment_uuid' => 'npm-ci-failure',
        'status' => 'failed',
        'pull_request_id' => 0,
        'logs' => json_encode([
            ...$noise,
            [
                'command' => null,
                'output' => "Dockerfile:20\n>>> RUN --mount=type=cache npm ci\nERROR: failed to build: failed to solve: process \"/bin/bash -ol pipefail -c npm ci\" did not complete successfully: exit code: 1\nexit status 1",
                'type' => 'stderr',
                'timestamp' => now()->toIso8601String(),
                'hidden' => false,
                'batch' => 2,
            ],
        ]),
    ]);

    app(DeploymentFailureAgentDispatcher::class)->dispatch(
        application: $this->application,
        deploymentUuid: 'npm-ci-failure',
        deploymentQueue: $deployment,
    );

    Queue::assertPushed(RunAgentJob::class, function (RunAgentJob $job): bool {
        $excerpt = collect($job->context['failure_excerpt'] ?? []);
        $messages = $excerpt->pluck('message')->implode("\n");

        return str_contains($messages, 'npm ci')
            && str_contains($messages, 'ERROR: failed to build')
            && ! str_contains($messages, 'SecretsUsedInArgOrEnv');
    });
});

it('prefers host Permission denied signals over npm warn noise in the failure excerpt', function () {
    Queue::fake();

    AiAgent::factory()->deployment()->create([
        'team_id' => $this->team->id,
        'provider_config_id' => $this->provider->id,
    ]);

    $deployment = ApplicationDeploymentQueue::create([
        'application_id' => $this->application->id,
        'deployment_uuid' => 'perm-denied-failure',
        'status' => 'failed',
        'pull_request_id' => 0,
        'logs' => json_encode([
            [
                'command' => null,
                'output' => 'Error response from daemon: No such container: perm-denied-failure',
                'type' => 'stderr',
                'timestamp' => now()->toIso8601String(),
                'hidden' => false,
                'batch' => 1,
            ],
            [
                'command' => null,
                'output' => "npm warn config production Use `--omit=dev` instead.\nnpm warn deprecated node-domexception@1.0.0",
                'type' => 'stderr',
                'timestamp' => now()->toIso8601String(),
                'hidden' => false,
                'batch' => 2,
            ],
            [
                'command' => null,
                'output' => 'tee: /media/Docker/AppData/coolify/data/applications/app-uuid/.env: Permission denied',
                'type' => 'stderr',
                'timestamp' => now()->toIso8601String(),
                'hidden' => false,
                'batch' => 3,
            ],
            [
                'command' => null,
                'output' => 'tee: /media/Docker/AppData/coolify/data/applications/app-uuid/docker-compose.yaml: Permission denied',
                'type' => 'stderr',
                'timestamp' => now()->toIso8601String(),
                'hidden' => false,
                'batch' => 4,
            ],
        ]),
    ]);

    app(DeploymentFailureAgentDispatcher::class)->dispatch(
        application: $this->application,
        deploymentUuid: 'perm-denied-failure',
        deploymentQueue: $deployment,
    );

    Queue::assertPushed(RunAgentJob::class, function (RunAgentJob $job): bool {
        $messages = collect($job->context['failure_excerpt'] ?? [])->pluck('message')->implode("\n");

        return str_contains($messages, 'Permission denied')
            && str_contains($messages, 'docker-compose.yaml')
            && ! str_contains($messages, 'npm warn')
            && ! str_contains($messages, 'No such container');
    });
});

it('redacts application secrets from the failure excerpt before LLM context', function () {
    Queue::fake();

    EnvironmentVariable::create([
        'key' => 'API_TOKEN',
        'value' => 'super-secret-token',
        'is_preview' => false,
        'resourceable_type' => Application::class,
        'resourceable_id' => $this->application->id,
    ]);

    AiAgent::factory()->deployment()->create([
        'team_id' => $this->team->id,
        'provider_config_id' => $this->provider->id,
    ]);

    $deployment = ApplicationDeploymentQueue::create([
        'application_id' => $this->application->id,
        'deployment_uuid' => 'secret-in-logs',
        'status' => 'failed',
        'pull_request_id' => 0,
        'logs' => json_encode([
            [
                'command' => null,
                'output' => 'ERROR: auth failed with token=super-secret-token exit code: 1',
                'type' => 'stderr',
                'timestamp' => now()->toIso8601String(),
                'hidden' => false,
                'batch' => 1,
            ],
        ]),
    ]);

    app(DeploymentFailureAgentDispatcher::class)->dispatch(
        application: $this->application,
        deploymentUuid: 'secret-in-logs',
        deploymentQueue: $deployment,
    );

    Queue::assertPushed(RunAgentJob::class, function (RunAgentJob $job): bool {
        $messages = collect($job->context['failure_excerpt'] ?? [])->pluck('message')->implode("\n");

        return str_contains($messages, REDACTED)
            && ! str_contains($messages, 'super-secret-token')
            && str_contains($messages, 'ERROR: auth failed');
    });
});
