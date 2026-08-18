<?php

use App\Models\Environment;
use App\Models\GithubApp;
use App\Models\PrivateKey;
use App\Models\Project;
use App\Models\Server;
use App\Models\StandaloneDocker;
use App\Models\Team;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;

uses(RefreshDatabase::class);

beforeEach(function () {
    config()->set('devforge.enabled', true);

    $this->user = User::factory()->create();
    $this->team = $this->user->teams()->firstOrFail();
    $this->session = ['currentTeam' => $this->team];

    $rsaKey = openssl_pkey_new([
        'private_key_bits' => 2048,
        'private_key_type' => OPENSSL_KEYTYPE_RSA,
    ]);
    openssl_pkey_export($rsaKey, $pemKey);

    $this->privateKey = PrivateKey::create([
        'name' => 'DevForge GitHub Key',
        'private_key' => $pemKey,
        'team_id' => $this->team->id,
    ]);

    $this->githubApp = GithubApp::create([
        'name' => 'DevForge GitHub App',
        'api_url' => 'https://api.github.com',
        'html_url' => 'https://github.com',
        'custom_user' => 'git',
        'custom_port' => 22,
        'app_id' => 12345,
        'installation_id' => 67890,
        'client_id' => 'test-client-id',
        'client_secret' => 'test-client-secret',
        'webhook_secret' => 'test-webhook-secret',
        'private_key_id' => $this->privateKey->id,
        'team_id' => $this->team->id,
        'is_system_wide' => false,
        'is_public' => false,
    ]);

    $this->server = Server::factory()->create([
        'team_id' => $this->team->id,
    ]);
    $this->destination = $this->server->standaloneDockers()->firstOrFail();
    $this->project = Project::factory()->create(['team_id' => $this->team->id]);
    $this->environment = Environment::factory()->create(['project_id' => $this->project->id]);
});

function fakeDevForgeGithubHttp(): void
{
    Http::fake([
        'https://api.github.com/zen' => Http::response('Keep it logically awesome.', 200, [
            'Date' => now()->toRfc7231String(),
        ]),
        'https://api.github.com/app/installations/67890/access_tokens' => Http::response([
            'token' => 'fake-installation-token',
        ], 201),
        'https://api.github.com/installation/repositories*' => Http::response([
            'total_count' => 1,
            'repositories' => [[
                'id' => 424242,
                'name' => 'demo-app',
                'full_name' => 'acme/demo-app',
                'owner' => ['login' => 'acme'],
                'private' => true,
                'html_url' => 'https://github.com/acme/demo-app',
                'default_branch' => 'main',
                'description' => 'Demo repository',
            ]],
        ], 200),
        'https://api.github.com/repos/acme/demo-app/branches*' => Http::response([
            ['name' => 'main', 'protected' => false],
            ['name' => 'develop', 'protected' => false],
        ], 200),
        'https://api.github.com/repos/acme/demo-app' => Http::response([
            'id' => 424242,
            'name' => 'demo-app',
            'full_name' => 'acme/demo-app',
        ], 200),
    ]);
}

it('lists github apps deployment targets and repositories for the current team', function () {
    fakeDevForgeGithubHttp();

    $otherTeam = Team::factory()->create();
    GithubApp::create([
        'name' => 'Other team app',
        'api_url' => 'https://api.github.com',
        'html_url' => 'https://github.com',
        'custom_user' => 'git',
        'custom_port' => 22,
        'app_id' => 99999,
        'installation_id' => 11111,
        'client_id' => 'other-client-id',
        'client_secret' => 'other-client-secret',
        'webhook_secret' => 'other-webhook-secret',
        'private_key_id' => $this->privateKey->id,
        'team_id' => $otherTeam->id,
        'is_system_wide' => false,
        'is_public' => false,
    ]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson('/api/devforge/v1/github/apps')
        ->assertSuccessful()
        ->assertJsonPath('data.0.uuid', $this->githubApp->uuid)
        ->assertJsonCount(1, 'data');

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson('/api/devforge/v1/deployment-targets')
        ->assertSuccessful()
        ->assertJsonPath('data.0.uuid', $this->server->uuid)
        ->assertJsonPath('data.0.destinations.0.uuid', $this->destination->uuid);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson("/api/devforge/v1/github/apps/{$this->githubApp->uuid}/repositories")
        ->assertSuccessful()
        ->assertJsonPath('data.0.full_name', 'acme/demo-app');

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson("/api/devforge/v1/github/apps/{$this->githubApp->uuid}/repositories/acme/demo-app/branches")
        ->assertSuccessful()
        ->assertJsonPath('data.0.name', 'main');
});

it('creates an application from a github repository', function () {
    fakeDevForgeGithubHttp();

    $response = $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson('/api/devforge/v1/applications', [
            'project_uuid' => $this->project->uuid,
            'environment_uuid' => $this->environment->uuid,
            'destination_uuid' => $this->destination->uuid,
            'github_app_uuid' => $this->githubApp->uuid,
            'git_repository' => 'acme/demo-app',
            'repository_id' => 424242,
            'git_branch' => 'main',
            'build_pack' => 'nixpacks',
            'instant_deploy' => false,
            'domains' => 'https://demo.example.com',
        ])
        ->assertCreated()
        ->assertJsonPath('data.type', 'application')
        ->assertJsonPath('data.name', 'demo-app')
        ->assertJsonPath('data.configuration.git_repository', 'acme/demo-app')
        ->assertJsonPath('data.configuration.git_branch', 'main')
        ->assertJsonPath('meta.instant_deploy', false);

    $uuid = $response->json('data.uuid');
    expect($uuid)->not->toBeEmpty();

    $application = \App\Models\Application::query()->where('uuid', $uuid)->first();
    expect($application)->not->toBeNull()
        ->and($application->name)->toBe('demo-app')
        ->and($application->redirect)->toBe('both')
        ->and($application->readiness)->not->toBeNull()
        ->and($application->readiness->autonomous_enabled)->toBeTrue();
});

it('imports dotenv contents before the first deployment when creating an application', function () {
    fakeDevForgeGithubHttp();

    $response = $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson('/api/devforge/v1/applications', [
            'project_uuid' => $this->project->uuid,
            'environment_uuid' => $this->environment->uuid,
            'destination_uuid' => $this->destination->uuid,
            'github_app_uuid' => $this->githubApp->uuid,
            'git_repository' => 'acme/demo-app',
            'repository_id' => 424242,
            'git_branch' => 'main',
            'build_pack' => 'nixpacks',
            'instant_deploy' => false,
            'env_contents' => "TURSO_DATABASE_URL=libsql://example.turso.io\nJWT_SECRET=super-secret\n",
        ])
        ->assertCreated()
        ->assertJsonPath('meta.instant_deploy', false)
        ->assertJsonPath('meta.env_import.created', 2)
        ->assertJsonPath('meta.env_import.updated', 0);

    $application = \App\Models\Application::query()->where('uuid', $response->json('data.uuid'))->firstOrFail();

    expect($application->environment_variables()->where('key', 'TURSO_DATABASE_URL')->first()?->value)
        ->toBe('libsql://example.turso.io')
        ->and($application->environment_variables()->where('key', 'JWT_SECRET')->first()?->value)
        ->toBe('super-secret');
});

it('rejects application creation when env_contents has no variables', function () {
    fakeDevForgeGithubHttp();

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson('/api/devforge/v1/applications', [
            'project_uuid' => $this->project->uuid,
            'environment_uuid' => $this->environment->uuid,
            'destination_uuid' => $this->destination->uuid,
            'github_app_uuid' => $this->githubApp->uuid,
            'git_repository' => 'acme/demo-app',
            'repository_id' => 424242,
            'git_branch' => 'main',
            'build_pack' => 'nixpacks',
            'instant_deploy' => false,
            'env_contents' => "# empty\n",
        ])
        ->assertStatus(422)
        ->assertJsonValidationErrors(['env_contents']);
});

it('rejects destinations from another team', function () {
    fakeDevForgeGithubHttp();

    $otherTeam = Team::factory()->create();
    $otherServer = Server::factory()->create(['team_id' => $otherTeam->id]);
    $otherDestination = $otherServer->standaloneDockers()->firstOrFail();

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson('/api/devforge/v1/applications', [
            'project_uuid' => $this->project->uuid,
            'environment_uuid' => $this->environment->uuid,
            'destination_uuid' => $otherDestination->uuid,
            'github_app_uuid' => $this->githubApp->uuid,
            'git_repository' => 'acme/demo-app',
            'repository_id' => 424242,
            'git_branch' => 'main',
            'build_pack' => 'nixpacks',
        ])
        ->assertNotFound();
});
