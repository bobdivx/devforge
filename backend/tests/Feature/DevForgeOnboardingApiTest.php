<?php

use App\Models\GithubApp;
use App\Models\S3Storage;
use App\Models\Server;
use App\Models\Team;
use App\Models\User;
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
        ->toContain('webhooks/source/github/install');
});

it('exposes onboarding steps in the bootstrap contract', function () {
    Server::factory()->create(['team_id' => $this->currentTeam->id]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson('/api/devforge/v1/bootstrap')
        ->assertSuccessful()
        ->assertJsonPath('data.onboarding.required', true)
        ->assertJsonPath('data.onboarding.steps.account', true)
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
        ->and(session('devforge_onboarding_github'))->toBeTrue()
        ->and(GithubApp::query()->where('team_id', $this->currentTeam->id)->where('name', 'devforge-app')->exists())->toBeTrue();

    $state = (string) str($response->json('data.launch.action_url'))->after('state=');
    expect(Cache::get('github-app-setup-state:'.hash('sha256', $state)))->toMatchArray([
        'action' => 'manifest',
        'team_id' => $this->currentTeam->id,
    ]);
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
        ->getJson('/api/devforge/v1/github/apps/'.$githubApp->uuid.'/install-url')
        ->assertSuccessful()
        ->assertJsonPath('data.url', fn (string $url): bool => str_contains($url, 'github.com/apps/installed-app/installations/new'));
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
        ->assertJsonPath('data.onboarding.steps.github', true)
        ->assertJsonPath('data.onboarding.steps.s3', true);
});
