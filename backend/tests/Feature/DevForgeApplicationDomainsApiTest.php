<?php

use App\Models\Application;
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

    $this->user = User::factory()->create();
    $this->team = $this->user->teams()->firstOrFail();
    $this->session = ['currentTeam' => $this->team];

    $this->server = Server::factory()->create([
        'team_id' => $this->team->id,
    ]);
    $this->server->settings->update([
        'wildcard_domain' => 'https://apps.example.com',
    ]);
    $this->destination = $this->server->standaloneDockers()->firstOrFail();
    $this->project = Project::factory()->create(['team_id' => $this->team->id]);
    $this->environment = Environment::factory()->create(['project_id' => $this->project->id]);

    $this->application = Application::factory()->create([
        'name' => 'Domain app',
        'environment_id' => $this->environment->id,
        'destination_id' => $this->destination->id,
        'destination_type' => StandaloneDocker::class,
        'git_repository' => 'acme/demo-app',
        'git_branch' => 'main',
        'build_pack' => 'nixpacks',
        'fqdn' => 'http://old.127.0.0.1.sslip.io',
        'redirect' => 'both',
    ]);
});

it('shows application domains and server wildcard', function () {
    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson("/api/devforge/v1/applications/{$this->application->uuid}/domains")
        ->assertSuccessful()
        ->assertJsonPath('data.fqdn', 'http://old.127.0.0.1.sslip.io')
        ->assertJsonPath('data.domains.0', 'http://old.127.0.0.1.sslip.io')
        ->assertJsonPath('data.redirect', 'both')
        ->assertJsonPath('data.wildcard_domain', 'https://apps.example.com')
        ->assertJsonPath('data.sslip_warning', true);
});

it('updates application domains', function () {
    $this->actingAs($this->user)
        ->withSession($this->session)
        ->putJson("/api/devforge/v1/applications/{$this->application->uuid}/domains", [
            'domains' => 'https://demo.apps.example.com',
            'redirect' => 'non-www',
            'redeploy' => false,
        ])
        ->assertSuccessful()
        ->assertJsonPath('data.fqdn', 'https://demo.apps.example.com')
        ->assertJsonPath('data.redirect', 'non-www')
        ->assertJsonPath('data.sslip_warning', false)
        ->assertJsonPath('meta.redeploy', null);

    expect($this->application->fresh()->fqdn)->toBe('https://demo.apps.example.com');
    expect($this->application->fresh()->redirect)->toBe('non-www');
});

it('queues a restart deployment when domains change', function () {
    $response = $this->actingAs($this->user)
        ->withSession($this->session)
        ->putJson("/api/devforge/v1/applications/{$this->application->uuid}/domains", [
            'domains' => 'https://demo.apps.example.com',
            'redeploy' => true,
        ])
        ->assertSuccessful()
        ->assertJsonPath('data.fqdn', 'https://demo.apps.example.com')
        ->assertJsonPath('meta.redeploy.queued', true);

    expect($response->json('meta.redeploy.deployment_uuid'))->not->toBeEmpty();
});

it('rejects invalid domain urls', function () {
    $this->actingAs($this->user)
        ->withSession($this->session)
        ->putJson("/api/devforge/v1/applications/{$this->application->uuid}/domains", [
            'domains' => 'not-a-url',
        ])
        ->assertStatus(422);
});

it('generates a domain from the server wildcard', function () {
    $response = $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson("/api/devforge/v1/applications/{$this->application->uuid}/domains/generate", [
            'redeploy' => false,
        ])
        ->assertSuccessful();

    $fqdn = $response->json('data.fqdn');
    $managed = $response->json('data.managed_domain');

    expect($fqdn)->toContain($this->application->uuid);
    expect($fqdn)->toContain('apps.example.com');
    expect($managed)->toBe($fqdn);
    expect($this->application->fresh()->fqdn)->toBe($fqdn);
    expect($response->json('meta.redeploy'))->toBeNull();
});

it('keeps custom domains when generating a managed domain', function () {
    $this->application->update([
        'fqdn' => 'https://custom.example.com,https://www.custom.example.com',
    ]);

    $response = $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson("/api/devforge/v1/applications/{$this->application->uuid}/domains/generate")
        ->assertSuccessful();

    $domains = $response->json('data.domains');
    $managed = $response->json('data.managed_domain');

    expect($managed)->toContain($this->application->uuid);
    expect($managed)->toContain('apps.example.com');
    expect($domains)->toContain($managed);
    expect($domains)->toContain('https://custom.example.com');
    expect($domains)->toContain('https://www.custom.example.com');
});

it('preserves the managed domain when it is omitted from an update', function () {
    $managed = 'https://'.$this->application->uuid.'.apps.example.com';
    $this->application->update([
        'fqdn' => "{$managed},https://custom.example.com",
    ]);

    $response = $this->actingAs($this->user)
        ->withSession($this->session)
        ->putJson("/api/devforge/v1/applications/{$this->application->uuid}/domains", [
            'domains' => 'https://custom.example.com,https://autre.example.com',
        ])
        ->assertSuccessful();

    $domains = $response->json('data.domains');

    expect($response->json('data.managed_domain'))->toBe($managed);
    expect($domains[0])->toBe($managed);
    expect($domains)->toContain('https://custom.example.com');
    expect($domains)->toContain('https://autre.example.com');
    expect($this->application->fresh()->fqdn)->toContain($managed);
});

it('creates applications with the server wildcard domain', function () {
    $githubApp = createDevForgeGithubAppForDomains($this->team, $this->user);

    fakeDevForgeGithubHttpForDomains();

    $response = $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson('/api/devforge/v1/applications', [
            'project_uuid' => $this->project->uuid,
            'environment_uuid' => $this->environment->uuid,
            'destination_uuid' => $this->destination->uuid,
            'github_app_uuid' => $githubApp->uuid,
            'git_repository' => 'acme/demo-app',
            'repository_id' => 424242,
            'git_branch' => 'main',
            'build_pack' => 'nixpacks',
            'instant_deploy' => false,
        ])
        ->assertCreated();

    $uuid = $response->json('data.uuid');
    $domains = $response->json('data.configuration.domains');

    expect($domains)->not->toBeEmpty();
    expect($domains[0])->toContain($uuid);
    expect($domains[0])->toContain('apps.example.com');
});

it('rejects domain updates for applications from another team', function () {
    $otherTeam = Team::factory()->create();
    $otherUser = User::factory()->create();
    $otherUser->teams()->attach($otherTeam->id, ['role' => 'owner']);

    $this->actingAs($otherUser)
        ->withSession(['currentTeam' => $otherTeam])
        ->putJson("/api/devforge/v1/applications/{$this->application->uuid}/domains", [
            'domains' => 'https://stolen.example.com',
        ])
        ->assertNotFound();
});

function createDevForgeGithubAppForDomains(Team $team, User $user): \App\Models\GithubApp
{
    $rsaKey = openssl_pkey_new([
        'private_key_bits' => 2048,
        'private_key_type' => OPENSSL_KEYTYPE_RSA,
    ]);
    openssl_pkey_export($rsaKey, $pemKey);

    $privateKey = \App\Models\PrivateKey::create([
        'name' => 'DevForge Domains Key',
        'private_key' => $pemKey,
        'team_id' => $team->id,
    ]);

    return \App\Models\GithubApp::create([
        'name' => 'DevForge Domains GitHub App',
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
        'team_id' => $team->id,
        'is_system_wide' => false,
        'is_public' => false,
    ]);
}

function fakeDevForgeGithubHttpForDomains(): void
{
    Illuminate\Support\Facades\Http::fake([
        'https://api.github.com/zen' => Illuminate\Support\Facades\Http::response('Keep it logically awesome.', 200, [
            'Date' => now()->toRfc7231String(),
        ]),
        'https://api.github.com/app/installations/67890/access_tokens' => Illuminate\Support\Facades\Http::response([
            'token' => 'fake-installation-token',
        ], 201),
        'https://api.github.com/installation/repositories*' => Illuminate\Support\Facades\Http::response([
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
        'https://api.github.com/repos/acme/demo-app/branches*' => Illuminate\Support\Facades\Http::response([
            ['name' => 'main', 'protected' => false],
        ], 200),
        'https://api.github.com/repos/acme/demo-app' => Illuminate\Support\Facades\Http::response([
            'id' => 424242,
            'name' => 'demo-app',
            'full_name' => 'acme/demo-app',
        ], 200),
    ]);
}
