<?php

use App\Models\GithubApp;
use App\Models\InstanceSettings;
use App\Models\Project;
use App\Models\S3Storage;
use App\Models\Server;
use App\Models\Team;
use App\Models\User;
use App\Services\DevForge\Onboarding\DefaultWorkspace;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;

uses(RefreshDatabase::class);

beforeEach(function () {
    config()->set('devforge.enabled', true);

    $this->user = User::factory()->create();
    $this->currentTeam = $this->user->teams()->firstOrFail();
    $this->currentTeam->update(['show_boarding' => true]);
    $this->session = ['currentTeam' => $this->currentTeam];
});

it('allows github app callbacks while boarding is required', function () {
    expect(allowedPathsForBoardingAccounts())
        ->toContain('webhooks/source/github/redirect')
        ->toContain('webhooks/source/github/install')
        ->toContain('login/github/manifest')
        ->toContain('login/github/setup')
        ->toContain('sanctum/csrf-cookie');
});

it('does not redirect sanctum csrf requests to onboarding while boarding', function () {
    $this->actingAs($this->user)
        ->withSession($this->session)
        ->get('/sanctum/csrf-cookie')
        ->assertSuccessful()
        ->assertHeaderMissing('Location');
});

it('uses a relative onboarding redirect for html pages while boarding', function () {
    $response = $this->actingAs($this->user)
        ->withSession($this->session)
        ->get('/settings');

    $response->assertRedirect('/onboarding');
    expect($response->headers->get('Location'))->toBe('/onboarding');
});

it('exposes onboarding steps in the bootstrap contract', function () {
    Server::factory()->create(['team_id' => $this->currentTeam->id]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson('/api/devforge/v1/bootstrap')
        ->assertSuccessful()
        ->assertJsonPath('data.onboarding.required', true)
        ->assertJsonPath('data.onboarding.steps.account', true)
        ->assertJsonPath('data.onboarding.steps.domain', false)
        ->assertJsonPath('data.onboarding.steps.github', false)
        ->assertJsonPath('data.onboarding.steps.s3', false)
        ->assertJsonPath('data.onboarding.steps.server', true);
});

it('completes onboarding and clears the boarding flag', function () {
    $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson('/api/devforge/v1/onboarding/complete')
        ->assertSuccessful()
        ->assertJsonPath('data.onboarding.required', false)
        ->assertJsonPath('data.onboarding.team_enabled', false);

    expect($this->currentTeam->fresh()->show_boarding)->toBeFalse();

    $project = Project::query()->where('team_id', $this->currentTeam->id)->first();
    expect($project)->not->toBeNull()
        ->and($project->name)->toBe(DefaultWorkspace::PROJECT_NAME)
        ->and($project->environments()->where('name', 'production')->exists())->toBeTrue();
});

it('restarts onboarding and keeps a default workspace', function () {
    $this->currentTeam->update(['show_boarding' => false]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson('/api/devforge/v1/onboarding/restart')
        ->assertSuccessful()
        ->assertJsonPath('data.onboarding.required', true)
        ->assertJsonPath('data.onboarding.team_enabled', true);

    expect($this->currentTeam->fresh()->show_boarding)->toBeTrue()
        ->and(Project::query()->where('team_id', $this->currentTeam->id)->where('name', DefaultWorkspace::PROJECT_NAME)->exists())->toBeTrue();
});

it('does not create a second default project when one already exists', function () {
    $existing = Project::create([
        'name' => 'Apps',
        'team_id' => $this->currentTeam->id,
    ]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson('/api/devforge/v1/onboarding/complete')
        ->assertSuccessful();

    expect(Project::query()->where('team_id', $this->currentTeam->id)->count())->toBe(1)
        ->and(Project::query()->whereKey($existing->id)->exists())->toBeTrue();
});

it('forbids members from restarting onboarding', function () {
    $member = User::factory()->create();
    $this->currentTeam->members()->attach($member, ['role' => 'member']);

    $this->actingAs($member)
        ->withSession($this->session)
        ->postJson('/api/devforge/v1/onboarding/restart')
        ->assertForbidden();

    expect($this->currentTeam->fresh()->show_boarding)->toBeTrue();
});

it('forbids members from completing onboarding', function () {
    $member = User::factory()->create();
    $this->currentTeam->members()->attach($member, ['role' => 'member']);

    $this->actingAs($member)
        ->withSession($this->session)
        ->postJson('/api/devforge/v1/onboarding/complete')
        ->assertForbidden();

    expect($this->currentTeam->fresh()->show_boarding)->toBeTrue();
});

it('starts a github app manifest from onboarding', function () {
    $response = $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson('/api/devforge/v1/github/apps', [
            'name' => 'devforge-app',
            'from_onboarding' => true,
            'preview_deployments' => true,
        ]);

    $response
        ->assertCreated()
        ->assertJsonPath('data.app.name', 'devforge-app')
        ->assertJsonPath('data.launch.manifest.name', 'devforge-app')
        ->assertJsonPath('data.launch.manifest.default_permissions.contents', 'read');

    expect($response->json('data.launch.action_url'))->toStartWith('https://github.com/settings/apps/new?state=')
        ->and($response->json('data.launch.manifest.redirect_url'))->toEndWith('/login/github/manifest')
        ->and($response->json('data.launch.manifest.setup_url'))->toEndWith('/login/github/setup')
        ->and($response->json('data.launch.manifest.hook_attributes.url'))->toEndWith('/webhooks/source/github/events')
        ->and(session('devforge_onboarding_github'))->toBeTrue()
        ->and(GithubApp::query()->where('team_id', $this->currentTeam->id)->where('name', 'devforge-app')->exists())->toBeTrue();

    $state = (string) str($response->json('data.launch.action_url'))->after('state=');
    expect(Cache::get('github-app-setup-state:'.hash('sha256', $state)))->toMatchArray([
        'action' => 'manifest',
        'team_id' => $this->currentTeam->id,
    ]);
});

it('reuses an incomplete github app draft when the setup is relaunched', function () {
    $draft = GithubApp::create([
        'name' => 'DevForge',
        'api_url' => 'https://api.github.com',
        'html_url' => 'https://github.com',
        'team_id' => $this->currentTeam->id,
        'is_public' => false,
    ]);

    $first = $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson('/api/devforge/v1/github/apps', [
            'name' => 'DevForge',
            'from_onboarding' => true,
        ]);

    $second = $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson('/api/devforge/v1/github/apps', [
            'name' => 'DevForge',
            'return_to' => 'applications',
        ]);

    $first->assertCreated();
    $second->assertCreated();

    expect($first->json('data.app.uuid'))->toBe($draft->uuid)
        ->and($second->json('data.app.uuid'))->toBe($draft->uuid)
        ->and(GithubApp::query()->where('team_id', $this->currentTeam->id)->whereNull('app_id')->count())->toBe(1)
        ->and(session('devforge_onboarding_github'))->toBeNull()
        ->and(session('devforge_github_return_to'))->toBe('applications');
});

it('returns an installation url for a configured github app', function () {
    $githubApp = GithubApp::create([
        'name' => 'Installed App',
        'api_url' => 'https://api.github.com',
        'html_url' => 'https://github.com',
        'app_id' => 42,
        'team_id' => $this->currentTeam->id,
        'is_public' => false,
    ]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson('/api/devforge/v1/github/apps/'.$githubApp->uuid.'/install-url?return_to=applications')
        ->assertSuccessful()
        ->assertJsonPath('data.url', fn (string $url): bool => str_contains($url, 'github.com/apps/installed-app/installations/new'));

    expect(session('devforge_github_return_to'))->toBe('applications');
});

it('marks github and s3 steps when those resources exist', function () {
    GithubApp::create([
        'name' => 'Team GitHub',
        'api_url' => 'https://api.github.com',
        'html_url' => 'https://github.com',
        'app_id' => 99,
        'installation_id' => 100,
        'team_id' => $this->currentTeam->id,
        'is_public' => false,
    ]);
    S3Storage::create([
        'name' => 'Backups',
        'region' => 'eu-west-1',
        'key' => 'key',
        'secret' => 'secret',
        'bucket' => 'backups',
        'endpoint' => 'https://s3.example.com',
        'team_id' => $this->currentTeam->id,
    ]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson('/api/devforge/v1/bootstrap')
        ->assertSuccessful()
        ->assertJsonPath('data.onboarding.steps.domain', false)
        ->assertJsonPath('data.onboarding.steps.github', true)
        ->assertJsonPath('data.onboarding.steps.s3', true);
});

it('marks the domain step when the instance fqdn is stored', function () {
    InstanceSettings::unguarded(fn (): InstanceSettings => InstanceSettings::query()->create([
        'id' => 0,
        'instance_name' => 'DevForge',
        'instance_timezone' => 'UTC',
        'fqdn' => 'http://zimacube.local:8080',
        'public_port_min' => 1025,
        'public_port_max' => 65535,
        'is_registration_enabled' => false,
        'disable_two_step_confirmation' => false,
        'is_auto_update_enabled' => false,
        'auto_update_frequency' => '0 0 * * *',
        'update_check_frequency' => '0 * * * *',
    ]));

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson('/api/devforge/v1/bootstrap')
        ->assertSuccessful()
        ->assertJsonPath('data.onboarding.steps.domain', true);
});

it('marks the domain step when the apps wildcard is stored', function () {
    InstanceSettings::unguarded(fn (): InstanceSettings => InstanceSettings::query()->create([
        'id' => 0,
        'instance_name' => 'DevForge',
        'instance_timezone' => 'UTC',
        'apps_wildcard_domain' => 'https://exemple.com',
        'public_port_min' => 1025,
        'public_port_max' => 65535,
        'is_registration_enabled' => false,
        'disable_two_step_confirmation' => false,
        'is_auto_update_enabled' => false,
        'auto_update_frequency' => '0 0 * * *',
        'update_check_frequency' => '0 * * * *',
    ]));

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson('/api/devforge/v1/bootstrap')
        ->assertSuccessful()
        ->assertJsonPath('data.onboarding.steps.domain', true);
});
