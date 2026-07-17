<?php

use App\Enums\ApplicationDeploymentStatus;
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
use App\Services\DevForge\DeploymentMonitoringData;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Queue;

uses(RefreshDatabase::class);

beforeEach(function () {
    config()->set('devforge.enabled', true);
    config()->set('devforge.agents_enabled', true);
    config()->set('devforge.agents_auto_fix_deployments', false);

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
        'name' => 'macompta',
    ]);
});

it('does not attach another application agent run via team-wide contextual window', function () {
    Queue::fake();

    $failedDeployment = ApplicationDeploymentQueue::create([
        'application_id' => $this->application->id,
        'deployment_uuid' => 'macompta-fail-uuid',
        'status' => ApplicationDeploymentStatus::FAILED->value,
        'pull_request_id' => 0,
        'created_at' => now()->subMinutes(5),
        'finished_at' => now()->subMinute(),
    ]);
    $failedDeployment->load('application');

    $otherApplication = Application::factory()->create([
        'environment_id' => $this->environment->id,
        'destination_id' => $this->destination->id,
        'destination_type' => StandaloneDocker::class,
        'status' => 'running',
        'name' => 'starbasefr',
    ]);

    $provider = AiProviderConfig::factory()->create(['team_id' => $this->team->id]);
    $teamWideAgent = AiAgent::factory()->create([
        'team_id' => $this->team->id,
        'type' => 'deployment',
        'provider_config_id' => $provider->id,
        'resource_uuid' => null,
    ]);

    AiAgentRun::factory()->create([
        'agent_id' => $teamWideAgent->id,
        'status' => 'completed',
        'trigger' => 'event',
        'summary' => 'Run starbasefr sans lien macompta.',
        'created_at' => now()->subMinutes(3),
        'metadata' => [
            'event' => 'deployment_failed',
            'application_uuid' => $otherApplication->uuid,
            'deployment_uuid' => 'other-app-deploy-uuid',
        ],
        'logs' => '[12:00:00] Contexte événement: {"event":"deployment_failed","application_uuid":"'.$otherApplication->uuid.'","deployment_uuid":"other-app-deploy-uuid"}'."\n",
    ]);

    $payload = app(DeploymentMonitoringData::class)->forDeployment($this->team, $failedDeployment);

    expect($payload['agent_runs'])->toBeEmpty();
});
