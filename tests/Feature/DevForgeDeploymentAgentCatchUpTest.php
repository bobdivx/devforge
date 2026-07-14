<?php

use App\Enums\ApplicationDeploymentStatus;
use App\Jobs\Agent\RunAgentJob;
use App\Models\AiAgent;
use App\Models\AiProviderConfig;
use App\Models\Application;
use App\Models\ApplicationDeploymentQueue;
use App\Models\Environment;
use App\Models\Project;
use App\Models\Server;
use App\Models\StandaloneDocker;
use App\Models\User;
use App\Services\DevForge\DeploymentMonitoringData;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Queue;

uses(RefreshDatabase::class);

beforeEach(function () {
    $this->user = User::factory()->create();
    $this->team = $this->user->teams()->firstOrFail();
    $this->server = Server::factory()->create(['team_id' => $this->team->id]);
    $this->destination = $this->server->standaloneDockers()->firstOrFail();
    $this->project = Project::factory()->create(['team_id' => $this->team->id]);
    $this->environment = Environment::factory()->create(['project_id' => $this->project->id]);
    $this->application = Application::factory()->create([
        'environment_id' => $this->environment->id,
        'destination_id' => $this->destination->id,
        'destination_type' => StandaloneDocker::class,
        'status' => 'running',
    ]);
});

function catchUpDeployment(Application $application, string $uuid, array $attributes = []): ApplicationDeploymentQueue
{
    return ApplicationDeploymentQueue::create(array_merge([
        'application_id' => $application->id,
        'deployment_uuid' => $uuid,
        'status' => ApplicationDeploymentStatus::FAILED->value,
        'pull_request_id' => 0,
        'finished_at' => now(),
    ], $attributes));
}

it('triggers a failure agent on monitoring when deployment failed without prior agent run', function () {
    Queue::fake();
    config()->set('devforge.agents_enabled', true);
    config()->set('devforge.agents_auto_fix_deployments', true);

    $failedDeployment = catchUpDeployment($this->application, 'catch-up-failed-uuid');
    $failedDeployment->load('application');

    $provider = AiProviderConfig::factory()->create(['team_id' => $this->team->id]);
    $agent = AiAgent::factory()->deployment()->create([
        'team_id' => $this->team->id,
        'provider_config_id' => $provider->id,
        'resource_uuid' => $this->application->uuid,
    ]);

    $payload = app(DeploymentMonitoringData::class)->forDeployment($this->team, $failedDeployment);

    expect($payload['catch_up_triggered'])->toBeTrue()
        ->and($payload['agent_runs'])->not->toBeEmpty();

    Queue::assertPushed(RunAgentJob::class, fn (RunAgentJob $job): bool => $job->agent->is($agent));
});

it('does not report catch up when the eligible agent is already running', function () {
    Queue::fake();
    config()->set('devforge.agents_enabled', true);
    config()->set('devforge.agents_auto_fix_deployments', true);

    $failedDeployment = catchUpDeployment($this->application, 'catch-up-busy-uuid');
    $failedDeployment->load('application');

    $provider = AiProviderConfig::factory()->create(['team_id' => $this->team->id]);
    AiAgent::factory()->deployment()->create([
        'team_id' => $this->team->id,
        'provider_config_id' => $provider->id,
        'status' => 'running',
    ]);

    $payload = app(DeploymentMonitoringData::class)->forDeployment($this->team, $failedDeployment);

    expect($payload['catch_up_triggered'])->toBeFalse()
        ->and($payload['agent_runs'])->toBeEmpty()
        ->and($payload['diagnostics']['blockers'])->not->toBeEmpty();

    Queue::assertNothingPushed();
});

it('does not catch up twice for the same failed deployment', function () {
    Queue::fake();
    config()->set('devforge.agents_enabled', true);
    config()->set('devforge.agents_auto_fix_deployments', true);

    $failedDeployment = catchUpDeployment($this->application, 'catch-up-once-uuid');
    $failedDeployment->load('application');

    $provider = AiProviderConfig::factory()->create(['team_id' => $this->team->id]);
    AiAgent::factory()->deployment()->create([
        'team_id' => $this->team->id,
        'provider_config_id' => $provider->id,
    ]);

    $monitoring = app(DeploymentMonitoringData::class);

    $monitoring->forDeployment($this->team, $failedDeployment);
    $secondPayload = $monitoring->forDeployment($this->team, $failedDeployment);

    expect($secondPayload['catch_up_triggered'])->toBeFalse();
    Queue::assertPushed(RunAgentJob::class, 1);
});
