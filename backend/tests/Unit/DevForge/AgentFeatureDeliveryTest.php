<?php

use App\Models\AiAgent;
use App\Models\AiAgentMission;
use App\Models\Application;
use App\Models\ApplicationPreview;
use App\Models\Environment;
use App\Models\Project;
use App\Models\Server;
use App\Models\StandaloneDocker;
use App\Models\Team;
use App\Services\DevForge\Agent\AgentFeatureDelivery;
use App\Services\DevForge\Agent\AgentPromptBuilder;
use Illuminate\Support\Facades\Schema;

beforeEach(function () {
    if (! Schema::hasTable('ai_agent_missions')) {
        $this->markTestSkipped('Migration ai_agent_missions non appliquée.');
    }
});

it('creates a feature delivery mission with PR constraints', function () {
    $team = Team::factory()->create();
    $server = Server::factory()->create(['team_id' => $team->id]);
    $destination = $server->standaloneDockers()->firstOrFail();
    $project = Project::factory()->create(['team_id' => $team->id]);
    $environment = Environment::factory()->create(['project_id' => $project->id]);
    $application = Application::factory()->create([
        'environment_id' => $environment->id,
        'destination_id' => $destination->id,
        'destination_type' => StandaloneDocker::class,
        'name' => 'Demo App',
    ]);

    $delivery = app(AgentFeatureDelivery::class);
    $result = $delivery->createRequest(
        $team,
        $application,
        'Ajouter un dark mode',
        'Toggle dans le header',
        'high',
        dispatchNow: false,
    );

    expect($result)->not->toHaveKey('error')
        ->and($result['mission'])->toBeInstanceOf(AiAgentMission::class)
        ->and($result['dispatched'])->toBeFalse();

    $mission = $result['mission'];
    expect($delivery->isFeatureDelivery($mission))->toBeTrue()
        ->and($mission->kind)->toBe('feature')
        ->and($mission->source)->toBe('feature_request')
        ->and($mission->resource_uuid)->toBe($application->uuid)
        ->and($mission->metadata['workflow'] ?? null)->toBe(AgentFeatureDelivery::WORKFLOW)
        ->and($mission->metadata['force_pull_request'] ?? null)->toBeTrue()
        ->and($mission->description)->toContain('mode=pull_request')
        ->and($mission->description)->toContain('Ne merge PAS');
});

it('tracks preview status after attaching a pull request', function () {
    $team = Team::factory()->create();
    $server = Server::factory()->create(['team_id' => $team->id]);
    $destination = $server->standaloneDockers()->firstOrFail();
    $project = Project::factory()->create(['team_id' => $team->id]);
    $environment = Environment::factory()->create(['project_id' => $project->id]);
    $application = Application::factory()->create([
        'environment_id' => $environment->id,
        'destination_id' => $destination->id,
        'destination_type' => StandaloneDocker::class,
    ]);

    $mission = app(AgentFeatureDelivery::class)->createRequest(
        $team,
        $application,
        'Feature PR',
        null,
        'normal',
        dispatchNow: false,
    )['mission'];

    $delivery = app(AgentFeatureDelivery::class);
    $delivery->attachPullRequest($mission, 42, 'https://github.com/acme/demo/pull/42', 'feat/demo');

    $mission->refresh();
    expect($mission->metadata['pull_request_number'] ?? null)->toBe(42)
        ->and($mission->metadata['awaiting'] ?? null)->toBe('preview');

    ApplicationPreview::query()->create([
        'application_id' => $application->id,
        'pull_request_id' => 42,
        'pull_request_html_url' => 'https://github.com/acme/demo/pull/42',
        'fqdn' => 'https://pr-42.preview.example.com',
        'status' => 'running:healthy',
    ]);

    $status = $delivery->deliveryStatus($team, $mission->fresh());
    expect($status['can_validate'])->toBeTrue()
        ->and($status['pull_request_number'])->toBe(42)
        ->and($status['preview']['fqdn'] ?? null)->toBe('https://pr-42.preview.example.com')
        ->and($status['awaiting'])->toBe('review');
});

it('includes feature delivery rules in mission_work prompts', function () {
    $agent = AiAgent::factory()->make([
        'type' => 'devforge',
        'system_prompt' => 'Base',
    ]);
    $agent->setRelation('team', Team::factory()->make(['name' => 'Acme']));

    $builder = app(AgentPromptBuilder::class);
    $system = $builder->autonomousSystemPrompt($agent, [
        'event' => 'mission_work',
        'workflow' => AgentFeatureDelivery::WORKFLOW,
        'force_pull_request' => true,
    ]);
    $message = $builder->autonomousInitialMessage($agent, [
        'event' => 'mission_work',
        'mission_uuid' => 'mission-uuid',
        'mission_title' => 'Dark mode',
        'mission_kind' => 'feature',
        'workflow' => AgentFeatureDelivery::WORKFLOW,
        'force_pull_request' => true,
        'application_uuid' => 'app-uuid',
    ]);

    expect($system)->toContain('workflow=feature_delivery')
        ->and($system)->toContain('INTERDIT merge_pull_request')
        ->and($message)->toContain('get_application_preview')
        ->and($message)->toContain('NE MERGE PAS');
});
