<?php

use App\Models\AiAgent;
use App\Models\AiAgentRun;
use App\Models\Application;
use App\Models\ApplicationDeploymentQueue;
use App\Models\ApplicationReadiness;
use App\Models\Environment;
use App\Models\GithubApp;
use App\Models\PrivateKey;
use App\Models\Project;
use App\Models\Server;
use App\Models\StandaloneDocker;
use App\Models\User;
use App\Services\DevForge\Readiness\ApplicationReadinessService;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

beforeEach(function () {
    config()->set('devforge.enabled', true);
    config()->set('devforge.agents_enabled', true);
    config()->set('devforge.readiness_enabled', true);

    $this->user = User::factory()->create();
    $this->team = $this->user->teams()->firstOrFail();
    $this->session = ['currentTeam' => $this->team];

    $this->server = Server::factory()->create(['team_id' => $this->team->id]);
    $this->destination = $this->server->standaloneDockers()->firstOrFail();
    $this->project = Project::factory()->create(['team_id' => $this->team->id]);
    $this->environment = Environment::factory()->create(['project_id' => $this->project->id]);

    $rsaKey = openssl_pkey_new([
        'private_key_bits' => 2048,
        'private_key_type' => OPENSSL_KEYTYPE_RSA,
    ]);
    openssl_pkey_export($rsaKey, $pemKey);

    $privateKey = PrivateKey::create([
        'name' => 'Topology GitHub Key',
        'private_key' => $pemKey,
        'team_id' => $this->team->id,
    ]);

    $this->githubApp = GithubApp::create([
        'name' => 'Team GitHub',
        'api_url' => 'https://api.github.com',
        'html_url' => 'https://github.com',
        'custom_user' => 'git',
        'custom_port' => 22,
        'app_id' => 12345,
        'installation_id' => 67890,
        'client_id' => 'test-client-id',
        'client_secret' => 'test-client-secret',
        'webhook_secret' => 'test-webhook-secret',
        'private_key_id' => $privateKey->id,
        'team_id' => $this->team->id,
        'is_system_wide' => false,
        'is_public' => false,
    ]);

    $this->application = Application::factory()->create([
        'environment_id' => $this->environment->id,
        'destination_id' => $this->destination->id,
        'destination_type' => StandaloneDocker::class,
        'source_id' => $this->githubApp->id,
        'source_type' => GithubApp::class,
        'git_repository' => 'acme/demo-app',
        'git_branch' => 'main',
        'fqdn' => 'https://demo.example.com',
        'status' => 'running:unknown',
        'name' => 'Demo App',
    ]);

    $readiness = app(ApplicationReadinessService::class)->ensureFor($this->application, true);
    $readiness->update([
        'status' => ApplicationReadiness::STATUS_HEALTHY,
        'last_probe_ok' => true,
        'last_http_status' => 200,
    ]);

    ApplicationDeploymentQueue::create([
        'application_id' => $this->application->id,
        'deployment_uuid' => 'dep-topology-1',
        'status' => 'finished',
        'commit' => 'abcdef1234567890',
        'commit_message' => 'Ship it',
        'is_webhook' => true,
        'pull_request_id' => 0,
    ]);
});

it('returns a relation canvas topology for the current team', function () {
    $agent = AiAgent::factory()->create([
        'team_id' => $this->team->id,
        'type' => 'deployment',
        'name' => 'Deploy Bot',
        'is_active' => true,
        'resource_uuid' => $this->application->uuid,
    ]);

    AiAgentRun::factory()->create([
        'agent_id' => $agent->id,
        'status' => 'completed',
        'trigger' => 'event',
        'summary' => 'Corrigé le build Nixpacks',
        'metadata' => ['deployment_uuid' => 'dep-topology-1'],
    ]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson('/api/devforge/v1/deployments/topology')
        ->assertSuccessful()
        ->assertJsonStructure([
            'data' => [
                'nodes' => [
                    ['id', 'type', 'label', 'subtitle', 'tone'],
                ],
                'edges' => [
                    ['id', 'from', 'to', 'kind', 'label'],
                ],
                'summary' => [
                    'applications',
                    'deployments',
                    'production_urls',
                    'agents',
                    'interventions',
                    'github_connections',
                    'repositories',
                    'reachable_urls',
                    'agents_enabled',
                ],
            ],
        ])
        ->assertJsonPath('data.summary.applications', 1)
        ->assertJsonPath('data.summary.production_urls', 1)
        ->assertJsonPath('data.summary.reachable_urls', 1)
        ->assertJsonFragment(['id' => 'hub:devforge', 'type' => 'hub'])
        ->assertJsonFragment(['id' => 'app:'.$this->application->uuid, 'type' => 'application'])
        ->assertJsonFragment(['id' => 'production:'.$this->application->uuid, 'type' => 'production'])
        ->assertJsonFragment(['id' => 'deployment:dep-topology-1', 'type' => 'deployment'])
        ->assertJsonFragment(['id' => 'agent:'.$agent->uuid, 'type' => 'agent']);
});

it('scopes topology applications to the current team', function () {
    $otherUser = User::factory()->create();
    $otherTeam = $otherUser->teams()->firstOrFail();
    $otherServer = Server::factory()->create(['team_id' => $otherTeam->id]);
    $otherDestination = $otherServer->standaloneDockers()->firstOrFail();
    $otherProject = Project::factory()->create(['team_id' => $otherTeam->id]);
    $otherEnvironment = Environment::factory()->create(['project_id' => $otherProject->id]);
    Application::factory()->create([
        'environment_id' => $otherEnvironment->id,
        'destination_id' => $otherDestination->id,
        'destination_type' => StandaloneDocker::class,
        'name' => 'Other Team App',
    ]);

    $response = $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson('/api/devforge/v1/deployments/topology')
        ->assertSuccessful();

    $labels = collect($response->json('data.nodes'))->pluck('label');

    expect($labels)->toContain('Demo App')
        ->and($labels)->not->toContain('Other Team App');
});
