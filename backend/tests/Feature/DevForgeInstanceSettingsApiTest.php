<?php

use App\Models\InstanceSettings;
use App\Models\OauthSetting;
use App\Models\Server;
use App\Models\Team;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;

uses(RefreshDatabase::class);

beforeEach(function () {
    config()->set('devforge.enabled', true);

    $this->user = User::factory()->create([
        'password' => Hash::make('secret-password'),
    ]);
    $this->rootTeam = Team::factory()->create(['id' => 0]);
    $this->rootTeam->members()->attach($this->user, ['role' => 'admin']);
    $this->session = ['currentTeam' => $this->rootTeam];

    InstanceSettings::unguarded(fn (): InstanceSettings => InstanceSettings::query()->create([
        'id' => 0,
        'instance_name' => 'DevForge',
        'instance_timezone' => 'UTC',
        'public_port_min' => 1025,
        'public_port_max' => 65535,
        'is_registration_enabled' => false,
        'disable_two_step_confirmation' => false,
        'is_auto_update_enabled' => false,
        'auto_update_frequency' => '0 0 * * *',
        'update_check_frequency' => '0 * * * *',
    ]));
});

it('updates instance settings for an instance admin', function () {
    $this->actingAs($this->user)
        ->withSession($this->session)
        ->putJson('/api/devforge/v1/settings/instance', [
            'instance_name' => 'Forge Lab',
            'instance_timezone' => 'Europe/Paris',
            'public_ipv4' => '203.0.113.10',
        ])
        ->assertSuccessful()
        ->assertJsonPath('data.instance.instance_name', 'Forge Lab')
        ->assertJsonPath('data.instance.instance_timezone', 'Europe/Paris')
        ->assertJsonPath('data.instance.public_ipv4', '203.0.113.10');

    expect(InstanceSettings::get()->instance_name)->toBe('Forge Lab');
});

it('forbids instance settings updates for non instance admins', function () {
    $outsider = User::factory()->create();
    $team = $outsider->teams()->firstOrFail();

    $this->actingAs($outsider)
        ->withSession(['currentTeam' => $team])
        ->putJson('/api/devforge/v1/settings/instance', [
            'instance_name' => 'Nope',
        ])
        ->assertForbidden();
});

it('updates advanced settings and requires password to enable registration', function () {
    $this->actingAs($this->user)
        ->withSession($this->session)
        ->putJson('/api/devforge/v1/settings/advanced', [
            'is_registration_enabled' => true,
        ])
        ->assertUnprocessable()
        ->assertJsonValidationErrors(['confirmation_password']);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->putJson('/api/devforge/v1/settings/advanced', [
            'is_registration_enabled' => true,
            'confirmation_password' => 'secret-password',
            'is_api_enabled' => true,
            'custom_dns_servers' => '1.1.1.1,8.8.8.8',
        ])
        ->assertSuccessful()
        ->assertJsonPath('data.advanced.is_registration_enabled', true)
        ->assertJsonPath('data.advanced.is_api_enabled', true)
        ->assertJsonPath('data.advanced.custom_dns_servers', '1.1.1.1,8.8.8.8');
});

it('updates agent feature toggles from advanced settings', function () {
    $this->actingAs($this->user)
        ->withSession($this->session)
        ->putJson('/api/devforge/v1/settings/advanced', [
            'agents' => [
                'dynamic_roles_enabled' => true,
                'role_model_routing' => false,
                'collab_enabled' => true,
                'code_sandbox_enabled' => false,
                'mcp_client_enabled' => true,
                'mcp_servers' => [
                    [
                        'id' => 'docs',
                        'url' => 'https://mcp.example.test/mcp',
                        'label' => 'Docs',
                        'token_env' => 'MCP_DOCS_TOKEN',
                    ],
                ],
            ],
        ])
        ->assertSuccessful()
        ->assertJsonPath('data.advanced.agents.code_sandbox_enabled', false)
        ->assertJsonPath('data.advanced.agents.mcp_client_enabled', true)
        ->assertJsonPath('data.advanced.agents.role_model_routing', false)
        ->assertJsonPath('data.advanced.agents.mcp_servers.0.id', 'docs');

    $stored = InstanceSettings::get()->agents_features;
    expect($stored['code_sandbox_enabled'])->toBeFalse()
        ->and($stored['mcp_servers'][0]['url'])->toBe('https://mcp.example.test/mcp');
});

it('updates email settings without leaking secrets', function () {
    $response = $this->actingAs($this->user)
        ->withSession($this->session)
        ->putJson('/api/devforge/v1/settings/email', [
            'smtp_enabled' => true,
            'smtp_from_address' => 'noreply@example.com',
            'smtp_from_name' => 'DevForge',
            'smtp_host' => 'smtp.example.com',
            'smtp_port' => 587,
            'smtp_encryption' => 'starttls',
            'smtp_password' => 'smtp-secret',
        ])
        ->assertSuccessful()
        ->assertJsonPath('data.email.smtp_enabled', true)
        ->assertJsonPath('data.email.smtp_from_address', 'noreply@example.com')
        ->assertJsonPath('data.email.smtp_password_set', true);

    expect($response->getContent())->not->toContain('smtp-secret')
        ->and($response->json('data.email'))->not->toHaveKey('smtp_password');
});

it('keeps existing smtp password when blank secret is sent', function () {
    InstanceSettings::get()->update([
        'smtp_enabled' => true,
        'smtp_from_address' => 'noreply@example.com',
        'smtp_from_name' => 'DevForge',
        'smtp_host' => 'smtp.example.com',
        'smtp_port' => 587,
        'smtp_encryption' => 'starttls',
        'smtp_password' => 'keep-me',
    ]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->putJson('/api/devforge/v1/settings/email', [
            'smtp_from_name' => 'Updated',
            'smtp_password' => '',
        ])
        ->assertSuccessful()
        ->assertJsonPath('data.email.smtp_from_name', 'Updated')
        ->assertJsonPath('data.email.smtp_password_set', true);

    expect(InstanceSettings::get()->smtp_password)->toBe('keep-me');
});

it('exposes and updates sso settings', function () {
    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson('/api/devforge/v1/settings')
        ->assertSuccessful()
        ->assertJsonPath('data.sso.sso_protect_apps_by_default', true)
        ->assertJsonPath('data.sso.sso_hide_local_login', false)
        ->assertJsonPath('data.sso.apps_protection_configured', false)
        ->assertJsonPath('data.sso.middleware_name', 'devforge-sso-auth')
        ->assertJsonPath('data.sso.managed_by_devforge', true)
        ->assertJsonPath('data.sso.default_forward_auth_address', 'http://devforge-sso-proxy:4180/');

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->putJson('/api/devforge/v1/settings/sso', [
            'sso_protect_apps_by_default' => false,
            'sso_forward_auth_address' => 'http://devforge-sso-proxy:4180/',
            'sso_hide_local_login' => true,
        ])
        ->assertSuccessful()
        ->assertJsonPath('data.sso.sso_protect_apps_by_default', false)
        ->assertJsonPath('data.sso.sso_forward_auth_address', 'http://devforge-sso-proxy:4180/')
        ->assertJsonPath('data.sso.sso_hide_local_login', true)
        ->assertJsonPath('data.sso.apps_protection_configured', true);

    expect(InstanceSettings::get()->sso_forward_auth_address)->toBe('http://devforge-sso-proxy:4180/');
});

it('updates update schedule settings', function () {
    $this->actingAs($this->user)
        ->withSession($this->session)
        ->putJson('/api/devforge/v1/settings/updates', [
            'is_auto_update_enabled' => true,
            'auto_update_frequency' => '0 3 * * *',
            'update_check_frequency' => '0 */6 * * *',
        ])
        ->assertSuccessful()
        ->assertJsonPath('data.updates.is_auto_update_enabled', true)
        ->assertJsonPath('data.updates.auto_update_frequency', '0 3 * * *')
        ->assertJsonPath('data.updates.update_check_frequency', '0 */6 * * *');
});

it('updates oauth provider settings without leaking client secret', function () {
    OauthSetting::create([
        'provider' => 'github',
        'enabled' => false,
        'client_id' => 'old-id',
        'client_secret' => 'old-secret',
        'redirect_uri' => 'https://example.test/oauth/github/callback',
    ]);

    $response = $this->actingAs($this->user)
        ->withSession($this->session)
        ->putJson('/api/devforge/v1/settings/oauth/github', [
            'enabled' => true,
            'client_id' => 'new-id',
            'client_secret' => 'new-secret',
            'redirect_uri' => 'https://example.test/oauth/github/callback',
        ])
        ->assertSuccessful()
        ->assertJsonPath('data.provider', 'github')
        ->assertJsonPath('data.enabled', true)
        ->assertJsonPath('data.client_id', 'new-id')
        ->assertJsonPath('data.client_secret_set', true);

    expect($response->getContent())->not->toContain('new-secret')
        ->and(OauthSetting::query()->where('provider', 'github')->firstOrFail()->client_secret)->toBe('new-secret');
});

it('stores the apps wildcard domain and copies it to empty servers', function () {
    $server = Server::factory()->create([
        'team_id' => $this->rootTeam->id,
    ]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->putJson('/api/devforge/v1/settings/instance', [
            'apps_wildcard_domain' => 'exemple.com',
            'force_save_domains' => true,
        ])
        ->assertSuccessful()
        ->assertJsonPath('data.instance.apps_wildcard_domain', 'https://exemple.com');

    expect(InstanceSettings::get()->apps_wildcard_domain)->toBe('https://exemple.com')
        ->and($server->settings->fresh()->wildcard_domain)->toBe('https://exemple.com');
});

it('rewrites generated application urls when the apps domain is saved', function () {
    $server = Server::factory()->create([
        'team_id' => $this->rootTeam->id,
    ]);
    $destination = $server->standaloneDockers()->firstOrFail();
    $project = \App\Models\Project::factory()->create(['team_id' => $this->rootTeam->id]);
    $environment = \App\Models\Environment::factory()->create(['project_id' => $project->id]);
    $application = \App\Models\Application::factory()->create([
        'name' => 'starbasefr',
        'environment_id' => $environment->id,
        'destination_id' => $destination->id,
        'destination_type' => \App\Models\StandaloneDocker::class,
        'git_repository' => 'acme/starbasefr',
        'git_branch' => 'main',
        'build_pack' => 'nixpacks',
        'fqdn' => 'https://starbasefr.com',
    ]);
    $application->update([
        'fqdn' => 'https://starbasefr.com,http://'.$application->uuid.'.127.0.0.1.sslip.io',
    ]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->putJson('/api/devforge/v1/settings/instance', [
            'apps_wildcard_domain' => 'exemple.com',
            'force_save_domains' => true,
        ])
        ->assertSuccessful();

    $application->refresh();
    $domains = str($application->fqdn)->explode(',')->map(fn (string $domain): string => trim($domain))->all();

    expect($domains)->toContain('https://starbasefr.com')
        ->and($domains)->toContain('https://starbasefr.exemple.com')
        ->and(collect($domains)->first(fn (string $domain): bool => str_contains($domain, $application->uuid)))->toContain('exemple.com')
        ->and($application->fqdn)->not->toContain('sslip.io');
});
