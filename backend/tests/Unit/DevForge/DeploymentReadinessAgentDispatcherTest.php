<?php

use App\Jobs\Agent\RunAgentJob;
use App\Models\AiAgent;
use App\Models\AiProviderConfig;
use App\Models\Application;
use App\Models\ApplicationReadiness;
use App\Models\Environment;
use App\Models\Project;
use App\Models\Server;
use App\Models\StandaloneDocker;
use App\Models\User;
use App\Services\DevForge\Agent\DeploymentReadinessAgentDispatcher;
use App\Services\DevForge\Readiness\ApplicationReadinessService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Queue;

uses(RefreshDatabase::class);

beforeEach(function () {
    config()->set('devforge.agents_enabled', true);
    config()->set('devforge.readiness_enabled', true);

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
        'fqdn' => 'https://demo.example.com',
    ]);
    $this->provider = AiProviderConfig::factory()->create(['team_id' => $this->team->id]);
});

it('dispatches a readiness agent outside the per-deployment quota', function () {
    Queue::fake();
    config()->set('devforge.agents_per_deployment_max_runs', 1);

    $agent = AiAgent::factory()->deployment()->create([
        'team_id' => $this->team->id,
        'provider_config_id' => $this->provider->id,
        'resource_uuid' => $this->application->uuid,
    ]);

    $readiness = app(ApplicationReadinessService::class)->ensureFor($this->application);
    $readiness->update([
        'round' => 1,
        'last_deployment_uuid' => 'deploy-ready-1',
        'status' => ApplicationReadiness::STATUS_RECOVERING,
    ]);

    $run = app(DeploymentReadinessAgentDispatcher::class)->dispatch(
        application: $this->application,
        readiness: $readiness->fresh(),
        probeResult: [
            'ok' => false,
            'url' => 'https://demo.example.com',
            'status' => 502,
            'error' => 'HTTP 502',
            'skipped' => false,
        ],
    );

    expect($run)->not->toBeNull();

    Queue::assertPushed(RunAgentJob::class, function (RunAgentJob $job) use ($agent): bool {
        return $job->agent->is($agent)
            && ($job->context['event'] ?? null) === DeploymentReadinessAgentDispatcher::EVENT
            && ($job->context['application_uuid'] ?? null) === $this->application->uuid;
    });
});
