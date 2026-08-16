<?php

use App\Http\Middleware\EnsureDevForgeEnabled;
use App\Http\Middleware\EnsureDevForgeUserIsVerified;
use App\Models\Team;
use App\Models\User;
use Illuminate\Cookie\Middleware\EncryptCookies;
use Illuminate\Foundation\Http\Middleware\VerifyCsrfToken;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Route;

uses(RefreshDatabase::class);

beforeEach(function () {
    config()->set('devforge.enabled', true);

    $this->user = User::factory()->create([
        'name' => 'DevForge User',
        'email' => 'devforge@example.com',
    ]);
    $this->currentTeam = $this->user->teams()->firstOrFail();
});

it('registers the isolated session API middleware', function () {
    $middleware = Route::getRoutes()
        ->getByName('devforge.api.bootstrap')
        ->gatherMiddleware();

    expect($middleware)
        ->toContain(EnsureDevForgeEnabled::class)
        ->toContain(EnsureDevForgeUserIsVerified::class)
        ->toContain(\App\Http\Middleware\EnsureDevForgeCurrentTeam::class)
        ->toContain('web')
        ->toContain('auth')
        ->toContain('verified');
});

it('rejects guests with a JSON response', function () {
    $this->getJson('/api/devforge/v1/bootstrap')
        ->assertUnauthorized()
        ->assertHeader('content-type', 'application/json');
});

it('does not expose the DevForge API while the global feature flag is disabled', function () {
    config()->set('devforge.enabled', false);

    $this->actingAs($this->user)
        ->withSession(['currentTeam' => $this->currentTeam])
        ->getJson('/api/devforge/v1/bootstrap')
        ->assertNotFound()
        ->assertHeader('content-type', 'application/json');
});

it('rejects unverified users', function () {
    config()->set('constants.coolify.self_hosted', false);
    $user = User::factory()->unverified()->create();
    $team = $user->teams()->firstOrFail();

    $this->actingAs($user)
        ->withSession(['currentTeam' => $team])
        ->getJson('/api/devforge/v1/bootstrap')
        ->assertForbidden()
        ->assertJsonPath('message', 'Your email address is not verified.');
});

it('allows unverified users on self-hosted instances', function () {
    config()->set('constants.coolify.self_hosted', true);
    $user = User::factory()->unverified()->create();
    $team = $user->teams()->firstOrFail();

    $this->actingAs($user)
        ->withSession(['currentTeam' => $team])
        ->getJson('/api/devforge/v1/bootstrap')
        ->assertSuccessful();
});

it('returns the authenticated bootstrap contract without sensitive data', function () {
    $response = $this->actingAs($this->user)
        ->withSession(['currentTeam' => $this->currentTeam])
        ->getJson('/api/devforge/v1/bootstrap');

    $response
        ->assertSuccessful()
        ->assertJsonStructure([
            'data' => [
                'user' => [
                    'id',
                    'name',
                    'email',
                    'email_verified',
                    'force_password_reset',
                    'two_factor_enabled',
                ],
                'current_team' => ['id', 'name', 'personal_team', 'role', 'is_current'],
                'teams' => [
                    '*' => ['id', 'name', 'personal_team', 'role', 'is_current'],
                ],
                'permissions' => [
                    'role',
                    'create_resources',
                    'manage_team',
                    'manage_members',
                    'access_terminal',
                    'instance_admin',
                ],
                'realtime' => [
                    'enabled',
                    'key',
                    'host',
                    'port',
                    'scheme',
                    'auth_endpoint',
                    'channels' => ['team', 'user'],
                ],
                'onboarding' => ['required', 'user_enabled', 'team_enabled', 'steps'],
                'cloud' => ['enabled', 'subscription_active', 'subscription_grace_period'],
                'migration' => ['enabled', 'legacy_base_url', 'domains'],
                'features' => ['agents_enabled'],
            ],
        ])
        ->assertJsonPath('data.user.id', $this->user->id)
        ->assertJsonPath('data.current_team.id', $this->currentTeam->id)
        ->assertJsonPath('data.current_team.role', 'owner')
        ->assertJsonPath('data.realtime.channels.team', 'team.'.$this->currentTeam->id)
        ->assertJsonPath('data.migration.enabled', true)
        ->assertJsonPath('data.migration.domains.projects', false)
        ->assertJsonPath('data.features.agents_enabled', false)
        ->assertJsonMissingPath('data.user.password')
        ->assertJsonMissingPath('data.user.remember_token')
        ->assertJsonMissingPath('data.user.two_factor_secret');
});

it('switches to another team in the existing session', function () {
    $targetTeam = Team::factory()->create();
    $this->user->teams()->attach($targetTeam, ['role' => 'member']);

    $response = $this->actingAs($this->user)
        ->withSession(['currentTeam' => $this->currentTeam])
        ->postJson('/api/devforge/v1/teams/switch', [
            'team_id' => $targetTeam->id,
        ]);

    $response
        ->assertSuccessful()
        ->assertJsonPath('data.current_team.id', $targetTeam->id)
        ->assertJsonPath('data.current_team.role', 'member')
        ->assertJsonPath('data.permissions.manage_team', false);

    expect(session('currentTeam')->id)->toBe($targetTeam->id);
});

it('rejects an invalid team identifier', function () {
    $this->actingAs($this->user)
        ->withSession(['currentTeam' => $this->currentTeam])
        ->postJson('/api/devforge/v1/teams/switch', [
            'team_id' => 'invalid',
        ])
        ->assertUnprocessable()
        ->assertJsonValidationErrors('team_id');

    expect(session('currentTeam')->id)->toBe($this->currentTeam->id);
});

it('forbids switching to a team belonging to another tenant', function () {
    $otherTeam = Team::factory()->create();

    $this->actingAs($this->user)
        ->withSession(['currentTeam' => $this->currentTeam])
        ->postJson('/api/devforge/v1/teams/switch', [
            'team_id' => $otherTeam->id,
        ])
        ->assertForbidden()
        ->assertJsonPath('message', 'You are not authorized to perform this action.');

    expect(session('currentTeam')->id)->toBe($this->currentTeam->id);
});

it('requires a valid CSRF token when switching teams', function () {
    $targetTeam = Team::factory()->create();
    $this->user->teams()->attach($targetTeam, ['role' => 'member']);

    app()->detectEnvironment(fn (): string => 'production');

    $this->actingAs($this->user)
        ->withSession(['currentTeam' => $this->currentTeam])
        ->withMiddleware(VerifyCsrfToken::class)
        ->withoutMiddleware(EncryptCookies::class)
        ->post('/api/devforge/v1/teams/switch', [
            'team_id' => $targetTeam->id,
        ], [
            'X-CSRF-TOKEN' => 'invalid-token',
        ])
        ->assertStatus(419)
        ->assertHeader('content-type', 'application/json');

    expect(session('currentTeam')->id)->toBe($this->currentTeam->id);
});
