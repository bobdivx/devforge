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
use App\Models\Team;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

beforeEach(function () {
    config()->set('devforge.enabled', true);
    config()->set('devforge.agents_enabled', true);
    config()->set('devforge.agents_auto_fix_deployments', true);

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

function monitoringDeployment(Application $application, string $uuid, array $attributes = []): ApplicationDeploymentQueue
{
    return ApplicationDeploymentQueue::create(array_merge([
        'application_id' => $application->id,
        'deployment_uuid' => $uuid,
        'status' => ApplicationDeploymentStatus::FAILED->value,
        'pull_request_id' => 0,
    ], $attributes));
}

it('returns deployment monitoring with linked agent runs and redeployments', function () {
    $failedDeployment = monitoringDeployment($this->application, 'failed-deploy-uuid');
    $redeployUuid = 'agent-redeploy-uuid';
    monitoringDeployment($this->application, $redeployUuid, [
        'status' => ApplicationDeploymentStatus::IN_PROGRESS->value,
    ]);

    $provider = AiProviderConfig::factory()->create(['team_id' => $this->team->id]);
    $agent = AiAgent::factory()->create([
        'team_id' => $this->team->id,
        'type' => 'deployment',
        'provider_config_id' => $provider->id,
        'resource_uuid' => $this->application->uuid,
    ]);

    AiAgentRun::factory()->create([
        'agent_id' => $agent->id,
        'status' => 'completed',
        'trigger' => 'event',
        'summary' => 'Build corrigé et redéployé.',
        'logs' => '[12:00:00] Contexte événement: {"event":"deployment_failed","deployment_uuid":"failed-deploy-uuid","application_uuid":"'.$this->application->uuid.'"}'."\n",
        'actions_taken' => [[
            'tool' => 'control_resource',
            'uuid' => $this->application->uuid,
            'type' => 'applications',
            'action' => 'deploy',
            'reason' => 'Correction du Dockerfile',
            'deployment_uuid' => $redeployUuid,
            'queued' => true,
            'at' => now()->toISOString(),
        ]],
    ]);

    $response = $this->actingAs($this->user)
        ->withSession(['currentTeam' => $this->team])
        ->getJson('/api/devforge/v1/deployments/failed-deploy-uuid/monitoring');

    $response
        ->assertSuccessful()
        ->assertJsonPath('data.deployment.uuid', 'failed-deploy-uuid')
        ->assertJsonPath('data.agents.enabled', true)
        ->assertJsonPath('data.diagnostics.eligible_agents_count', 1)
        ->assertJsonPath('data.agent_runs.0.summary', 'Build corrigé et redéployé.')
        ->assertJsonPath('data.agent_runs.0.event_context.event', 'deployment_failed')
        ->assertJsonPath('data.agent_runs.0.actions_taken.0.deployment_uuid', $redeployUuid)
        ->assertJsonPath('data.redeployments.0.uuid', $redeployUuid);
});

it('links a manual agent run to a deployment by application and time window', function () {
    $failedDeployment = monitoringDeployment($this->application, 'contextual-deploy-uuid', [
        'created_at' => now()->subMinutes(5),
        'finished_at' => now()->subMinute(),
    ]);

    $provider = AiProviderConfig::factory()->create(['team_id' => $this->team->id]);
    $agent = AiAgent::factory()->create([
        'team_id' => $this->team->id,
        'type' => 'deployment',
        'provider_config_id' => $provider->id,
        'resource_uuid' => $this->application->uuid,
    ]);

    AiAgentRun::factory()->create([
        'agent_id' => $agent->id,
        'status' => 'running',
        'trigger' => 'manual',
        'summary' => 'Analyse lancée depuis la fiche agent.',
        'created_at' => now()->subMinutes(3),
    ]);

    $this->actingAs($this->user)
        ->withSession(['currentTeam' => $this->team])
        ->getJson('/api/devforge/v1/deployments/contextual-deploy-uuid/monitoring')
        ->assertSuccessful()
        ->assertJsonPath('data.agent_runs.0.summary', 'Analyse lancée depuis la fiche agent.')
        ->assertJsonPath('data.agent_runs.0.linkage', 'context');
});

it('returns diagnostics blockers when no agent can run', function () {
    monitoringDeployment($this->application, 'blocked-deploy-uuid');

    $this->actingAs($this->user)
        ->withSession(['currentTeam' => $this->team])
        ->getJson('/api/devforge/v1/deployments/blocked-deploy-uuid/monitoring')
        ->assertSuccessful()
        ->assertJsonPath('data.diagnostics.eligible_agents_count', 0)
        ->assertJson(fn ($json) => $json->where('data.diagnostics.blockers', fn ($blockers): bool => count($blockers) > 0)->etc());
});

it('scopes deployment monitoring to the current team', function () {
    $deployment = monitoringDeployment($this->application, 'tenant-deployment');

    $otherTeam = Team::factory()->create();
    $otherProject = Project::factory()->create(['team_id' => $otherTeam->id]);
    $otherEnvironment = Environment::factory()->create(['project_id' => $otherProject->id]);
    $otherApplication = Application::factory()->create(['environment_id' => $otherEnvironment->id]);
    $otherDeployment = monitoringDeployment($otherApplication, 'foreign-deployment');

    $this->actingAs($this->user)
        ->withSession(['currentTeam' => $this->team])
        ->getJson('/api/devforge/v1/deployments/'.$deployment->deployment_uuid.'/monitoring')
        ->assertSuccessful()
        ->assertJsonPath('data.deployment.uuid', $deployment->deployment_uuid);

    $this->actingAs($this->user)
        ->withSession(['currentTeam' => $this->team])
        ->getJson('/api/devforge/v1/deployments/'.$otherDeployment->deployment_uuid.'/monitoring')
        ->assertNotFound();
});
