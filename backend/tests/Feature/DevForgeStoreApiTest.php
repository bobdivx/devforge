<?php

use App\Models\Application;
use App\Models\Environment;
use App\Models\GithubApp;
use App\Models\PrivateKey;
use App\Models\Project;
use App\Models\Server;
use App\Models\StandaloneDocker;
use App\Models\StoreListing;
use App\Models\Team;
use App\Models\User;
use App\Services\DevForge\Store\StoreListingPublisher;
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

    $this->application = Application::factory()->create([
        'name' => 'Demo Store App',
        'environment_id' => $this->environment->id,
        'destination_id' => $this->destination->id,
        'destination_type' => StandaloneDocker::class,
        'git_repository' => 'acme/demo-app',
        'git_branch' => 'main',
        'build_pack' => 'nixpacks',
        'ports_exposes' => '3000',
        'status' => 'running:healthy',
    ]);
});

function fakeStoreGithubHttp(): void
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
                'private' => false,
                'html_url' => 'https://github.com/acme/demo-app',
                'default_branch' => 'main',
                'description' => 'Demo repository',
            ]],
        ], 200),
        'https://api.github.com/repos/acme/demo-app/branches*' => Http::response([
            ['name' => 'main', 'protected' => false],
        ], 200),
        'https://api.github.com/repos/acme/demo-app' => Http::response([
            'id' => 424242,
            'name' => 'demo-app',
            'full_name' => 'acme/demo-app',
        ], 200),
    ]);
}

it('refuses to publish an application that is not running', function () {
    $this->application->update(['status' => 'exited']);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson("/api/devforge/v1/applications/{$this->application->uuid}/store/publish", [
            'name' => 'Demo',
            'slug' => 'demo-app',
        ])
        ->assertUnprocessable()
        ->assertJsonValidationErrors(['application']);
});

it('previews publishable environment variables without leaking values', function () {
    $this->application->environment_variables()->create([
        'key' => 'APP_NAME',
        'value' => 'secret-name',
        'is_preview' => false,
        'is_runtime' => true,
        'is_buildtime' => true,
    ]);
    $this->application->environment_variables()->create([
        'key' => 'API_TOKEN',
        'value' => 'super-secret',
        'is_preview' => false,
        'is_runtime' => true,
        'is_buildtime' => true,
    ]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson("/api/devforge/v1/applications/{$this->application->uuid}/store/publish-preview")
        ->assertSuccessful()
        ->assertJsonPath('data.publishable', true)
        ->assertJsonPath('data.environment_variables.0.key', 'API_TOKEN')
        ->assertJsonPath('data.environment_variables.0.is_secret', true)
        ->assertJsonPath('data.environment_variables.0.included', false)
        ->assertJsonPath('data.environment_variables.1.key', 'APP_NAME')
        ->assertJsonPath('data.environment_variables.1.default', null)
        ->assertJsonMissingPath('data.environment_variables.0.value');
});

it('publishes a running application and lets another team install it', function () {
    fakeStoreGithubHttp();

    $this->application->environment_variables()->create([
        'key' => 'APP_NAME',
        'value' => 'should-not-leak',
        'is_preview' => false,
        'is_runtime' => true,
        'is_buildtime' => true,
        'comment' => 'Nom public',
    ]);
    $this->application->environment_variables()->create([
        'key' => 'API_TOKEN',
        'value' => 'live-secret',
        'is_preview' => false,
        'is_runtime' => true,
        'is_buildtime' => true,
    ]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson("/api/devforge/v1/applications/{$this->application->uuid}/store/publish", [
            'name' => 'Demo Store App',
            'slug' => 'demo-store-app',
            'description' => 'Une app de démo.',
            'category' => 'web',
            'runtime_defaults' => [
                'build_pack' => 'nixpacks',
                'ports_exposes' => '3000',
                'start_command' => 'npm start',
            ],
            'env_schema' => [
                [
                    'key' => 'APP_NAME',
                    'included' => true,
                    'is_secret' => false,
                    'required' => false,
                    'default' => 'Demo',
                    'description' => 'Nom public',
                ],
                [
                    'key' => 'API_TOKEN',
                    'included' => true,
                    'is_secret' => true,
                    'required' => true,
                    'default' => 'live-secret',
                ],
            ],
        ])
        ->assertCreated()
        ->assertJsonPath('data.slug', 'demo-store-app')
        ->assertJsonPath('data.env_schema.0.default', 'Demo')
        ->assertJsonPath('data.env_schema.1.default', null)
        ->assertJsonPath('data.env_schema.1.is_secret', true);

    expect(StoreListing::query()->where('slug', 'demo-store-app')->first()->env_schema)
        ->toBeArray()
        ->and(collect(StoreListing::query()->where('slug', 'demo-store-app')->value('env_schema'))->firstWhere('key', 'API_TOKEN')['default'] ?? 'missing')
        ->toBeNull();

    $otherUser = User::factory()->create();
    $otherTeam = $otherUser->teams()->firstOrFail();
    $otherSession = ['currentTeam' => $otherTeam];

    $otherServer = Server::factory()->create(['team_id' => $otherTeam->id]);
    $otherDestination = $otherServer->standaloneDockers()->firstOrFail();
    $otherProject = Project::factory()->create(['team_id' => $otherTeam->id]);
    $otherEnvironment = Environment::factory()->create(['project_id' => $otherProject->id]);

    $otherPrivateKey = PrivateKey::create([
        'name' => 'Other GitHub Key',
        'private_key' => $this->privateKey->private_key,
        'team_id' => $otherTeam->id,
    ]);
    $otherGithubApp = GithubApp::create([
        'name' => 'Other GitHub App',
        'api_url' => 'https://api.github.com',
        'html_url' => 'https://github.com',
        'custom_user' => 'git',
        'custom_port' => 22,
        'app_id' => 54321,
        'installation_id' => 67890,
        'client_id' => 'other-client-id',
        'client_secret' => 'other-client-secret',
        'webhook_secret' => 'other-webhook-secret',
        'private_key_id' => $otherPrivateKey->id,
        'team_id' => $otherTeam->id,
        'is_system_wide' => false,
        'is_public' => false,
    ]);

    $this->actingAs($otherUser)
        ->withSession($otherSession)
        ->getJson('/api/devforge/v1/store/listings')
        ->assertSuccessful()
        ->assertJsonPath('data.0.slug', 'demo-store-app');

    $this->actingAs($otherUser)
        ->withSession($otherSession)
        ->postJson('/api/devforge/v1/store/listings/demo-store-app/install', [
            'project_uuid' => $otherProject->uuid,
            'environment_uuid' => $otherEnvironment->uuid,
            'destination_uuid' => $otherDestination->uuid,
            'github_app_uuid' => $otherGithubApp->uuid,
            'name' => 'Installed Demo',
            'instant_deploy' => false,
            'env_values' => [
                'API_TOKEN' => 'installer-secret',
                'APP_NAME' => 'Installed',
            ],
        ])
        ->assertCreated()
        ->assertJsonPath('data.name', 'Installed Demo');

    $installed = Application::query()->where('name', 'Installed Demo')->firstOrFail();
    expect($installed->git_repository)->toBe('acme/demo-app')
        ->and($installed->start_command)->toBe('npm start')
        ->and($installed->environment_variables()->where('key', 'APP_NAME')->first()?->value)->toBe('Installed')
        ->and($installed->environment_variables()->where('key', 'API_TOKEN')->first()?->value)->toBe('installer-secret')
        ->and(StoreListing::query()->where('slug', 'demo-store-app')->value('install_count'))->toBe(1);
});

it('requires secret env values when installing from the store', function () {
    StoreListing::factory()->create([
        'team_id' => $this->team->id,
        'slug' => 'needs-secret',
        'name' => 'Needs Secret',
        'git_repository' => 'acme/demo-app',
        'git_branch' => 'main',
        'env_schema' => [[
            'key' => 'API_TOKEN',
            'is_secret' => true,
            'required' => true,
            'default' => null,
        ]],
    ]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson('/api/devforge/v1/store/listings/needs-secret/install', [
            'project_uuid' => $this->project->uuid,
            'environment_uuid' => $this->environment->uuid,
            'destination_uuid' => $this->destination->uuid,
            'github_app_uuid' => $this->githubApp->uuid,
            'instant_deploy' => false,
        ])
        ->assertUnprocessable()
        ->assertJsonValidationErrors(['env_values.API_TOKEN']);
});
