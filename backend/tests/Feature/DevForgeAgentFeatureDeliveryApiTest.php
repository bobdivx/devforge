<?php

use App\Models\AiAgent;
use App\Models\AiAgentMission;
use App\Models\Application;
use App\Models\Environment;
use App\Models\Project;
use App\Models\Server;
use App\Models\StandaloneDocker;
use App\Models\User;
use App\Services\DevForge\Agent\AgentFeatureDelivery;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Schema;

uses(RefreshDatabase::class);

beforeEach(function () {
    if (! Schema::hasTable('ai_agent_missions')) {
        $this->markTestSkipped('Migration ai_agent_missions non appliquée.');
    }

    config()->set('devforge.enabled', true);
    config()->set('devforge.agents_enabled', true);

    $this->user = User::factory()->create();
    $this->team = $this->user->teams()->firstOrFail();
    $this->session = ['currentTeam' => $this->team];

    $this->server = Server::factory()->create(['team_id' => $this->team->id]);
    $this->destination = $this->server->standaloneDockers()->firstOrFail();
    $this->project = Project::factory()->create(['team_id' => $this->team->id]);
    $this->environment = Environment::factory()->create(['project_id' => $this->project->id]);
    $this->application = Application::factory()->create([
        'name' => 'Feature App',
        'environment_id' => $this->environment->id,
        'destination_id' => $this->destination->id,
        'destination_type' => StandaloneDocker::class,
    ]);
});

it('creates a feature request mission for an application', function () {
    AiAgent::factory()->create([
        'team_id' => $this->team->id,
        'type' => 'devforge',
        'is_active' => true,
    ]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson("/api/devforge/v1/applications/{$this->application->uuid}/feature-requests", [
            'title' => 'Ajouter un export CSV',
            'description' => 'Bouton dans la liste',
            'priority' => 'high',
            'dispatch_now' => false,
        ])
        ->assertCreated()
        ->assertJsonPath('data.mission.kind', 'feature')
        ->assertJsonPath('data.mission.source', 'feature_request')
        ->assertJsonPath('data.mission.resource_uuid', $this->application->uuid)
        ->assertJsonPath('data.dispatched', false)
        ->assertJsonPath('data.feature_delivery.workflow', AgentFeatureDelivery::WORKFLOW)
        ->assertJsonPath('data.feature_delivery.force_pull_request', true)
        ->assertJsonPath('data.feature_delivery.application_uuid', $this->application->uuid);

    $mission = AiAgentMission::query()->where('team_id', $this->team->id)->first();
    expect($mission)->not->toBeNull()
        ->and($mission->metadata['workflow'] ?? null)->toBe(AgentFeatureDelivery::WORKFLOW);
});

it('returns delivery status for a feature mission', function () {
    $mission = app(AgentFeatureDelivery::class)->createRequest(
        $this->team,
        $this->application,
        'Status check',
        null,
        'normal',
        dispatchNow: false,
    )['mission'];

    app(AgentFeatureDelivery::class)->attachPullRequest(
        $mission,
        7,
        'https://github.com/acme/app/pull/7',
        'feat/status',
    );

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson("/api/devforge/v1/ai/missions/{$mission->uuid}/delivery")
        ->assertSuccessful()
        ->assertJsonPath('data.feature_delivery.pull_request_number', 7)
        ->assertJsonPath('data.feature_delivery.can_validate', true)
        ->assertJsonPath('data.mission.is_feature_delivery', true);
});

it('rejects validate without a pull request', function () {
    $mission = app(AgentFeatureDelivery::class)->createRequest(
        $this->team,
        $this->application,
        'No PR yet',
        null,
        'normal',
        dispatchNow: false,
    )['mission'];

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson("/api/devforge/v1/ai/missions/{$mission->uuid}/delivery/validate", [
            'merge_method' => 'squash',
        ])
        ->assertStatus(422)
        ->assertJsonPath('message', 'Aucune PR enregistrée sur cette mission.');
});
