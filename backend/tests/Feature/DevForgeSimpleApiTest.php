<?php

use App\Models\InstanceSettings;
use App\Models\OauthSetting;
use App\Models\Project;
use App\Models\SharedEnvironmentVariable;
use App\Models\Team;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

uses(RefreshDatabase::class);

beforeEach(function () {
    config()->set('devforge.enabled', true);

    $this->user = User::factory()->create();
    $this->team = $this->user->teams()->firstOrFail();
    $this->session = ['currentTeam' => $this->team];
});

it('returns a current-team-only dashboard and project list', function () {
    $project = Project::factory()->create([
        'team_id' => $this->team->id,
        'uuid' => (string) Str::uuid(),
    ]);
    $otherTeam = Team::factory()->create();
    $otherProject = Project::factory()->create([
        'team_id' => $otherTeam->id,
        'uuid' => (string) Str::uuid(),
    ]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson('/api/devforge/v1/dashboard')
        ->assertSuccessful()
        ->assertJsonPath('data.counts.projects', 1);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson('/api/devforge/v1/projects')
        ->assertSuccessful()
        ->assertJsonFragment(['uuid' => $project->uuid])
        ->assertJsonMissing(['uuid' => $otherProject->uuid]);
});

it('creates validates updates and deletes basic projects and environments', function () {
    $projectResponse = $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson('/api/devforge/v1/projects', [
            'name' => 'DevForge Project',
            'description' => 'A safe project',
        ])
        ->assertCreated()
        ->assertJsonPath('data.name', 'DevForge Project')
        ->assertJsonCount(1, 'data.environments');

    $projectUuid = $projectResponse->json('data.uuid');

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson("/api/devforge/v1/projects/{$projectUuid}/environments", [
            'name' => '<script>',
        ])
        ->assertUnprocessable()
        ->assertJsonValidationErrors('name');

    $environmentResponse = $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson("/api/devforge/v1/projects/{$projectUuid}/environments", [
            'name' => 'staging',
            'description' => 'Staging environment',
        ])
        ->assertCreated();

    $environmentUuid = $environmentResponse->json('data.uuid');

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->putJson("/api/devforge/v1/projects/{$projectUuid}/environments/{$environmentUuid}", [
            'name' => 'testing',
            'description' => null,
        ])
        ->assertSuccessful()
        ->assertJsonPath('data.name', 'testing');

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->deleteJson("/api/devforge/v1/projects/{$projectUuid}/environments/{$environmentUuid}")
        ->assertNoContent();

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->putJson("/api/devforge/v1/projects/{$projectUuid}", [
            'name' => 'Renamed Project',
            'description' => null,
        ])
        ->assertSuccessful()
        ->assertJsonPath('data.name', 'Renamed Project');

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->deleteJson("/api/devforge/v1/projects/{$projectUuid}")
        ->assertNoContent();

    expect(Project::query()->where('uuid', $projectUuid)->exists())->toBeFalse();
});

it('never resolves project or environment resources from another tenant', function () {
    $otherTeam = Team::factory()->create();
    $otherProject = Project::factory()->create([
        'team_id' => $otherTeam->id,
        'uuid' => (string) Str::uuid(),
    ]);
    $otherEnvironment = $otherProject->environments()->firstOrFail();

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson("/api/devforge/v1/projects/{$otherProject->uuid}")
        ->assertNotFound();

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson(
            "/api/devforge/v1/projects/{$otherProject->uuid}/environments/{$otherEnvironment->uuid}"
        )
        ->assertNotFound();
});

it('never mutates project or environment resources from another tenant', function () {
    $otherTeam = Team::factory()->create();
    $otherProject = Project::factory()->create([
        'team_id' => $otherTeam->id,
        'uuid' => (string) Str::uuid(),
        'name' => 'Other tenant project',
    ]);
    $otherEnvironment = $otherProject->environments()->firstOrFail();
    $originalEnvironmentName = $otherEnvironment->name;

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson("/api/devforge/v1/projects/{$otherProject->uuid}/environments", [
            'name' => 'unauthorized-environment',
        ])
        ->assertNotFound();

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->putJson("/api/devforge/v1/projects/{$otherProject->uuid}", [
            'name' => 'Unauthorized project rename',
        ])
        ->assertNotFound();

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->putJson("/api/devforge/v1/projects/{$otherProject->uuid}/environments/{$otherEnvironment->uuid}", [
            'name' => 'unauthorized-environment-rename',
        ])
        ->assertNotFound();

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->deleteJson("/api/devforge/v1/projects/{$otherProject->uuid}/environments/{$otherEnvironment->uuid}")
        ->assertNotFound();

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->deleteJson("/api/devforge/v1/projects/{$otherProject->uuid}")
        ->assertNotFound();

    expect($otherProject->refresh()->name)->toBe('Other tenant project')
        ->and($otherEnvironment->refresh()->name)->toBe($originalEnvironmentName);
});

it('rejects a selected team outside the authenticated user memberships', function () {
    $otherTeam = Team::factory()->create();

    $this->actingAs($this->user)
        ->withSession(['currentTeam' => $otherTeam])
        ->getJson('/api/devforge/v1/overview')
        ->assertForbidden()
        ->assertJsonPath('message', 'The selected team is not available.');
});

it('reads and validates only the authenticated profile', function () {
    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson('/api/devforge/v1/profile')
        ->assertSuccessful()
        ->assertJsonPath('data.id', $this->user->id)
        ->assertJsonPath('data.two_factor_enabled', false)
        ->assertJsonMissingPath('data.password')
        ->assertJsonMissingPath('data.two_factor_secret');

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->putJson('/api/devforge/v1/profile', ['name' => '<invalid>'])
        ->assertUnprocessable()
        ->assertJsonValidationErrors('name');

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->putJson('/api/devforge/v1/profile', ['name' => 'Updated User'])
        ->assertSuccessful()
        ->assertJsonPath('data.name', 'Updated User');
});

it('lists only current team members and user teams', function () {
    $member = User::factory()->create();
    $this->team->members()->attach($member, ['role' => 'member']);
    $unrelated = User::factory()->create();

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson('/api/devforge/v1/teams/current/members')
        ->assertSuccessful()
        ->assertJsonFragment(['email' => $member->email])
        ->assertJsonMissing(['email' => $unrelated->email]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson('/api/devforge/v1/teams')
        ->assertSuccessful()
        ->assertJsonFragment(['id' => $this->team->id]);
});

it('updates current team details and manages invitations for admins', function () {
    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson('/api/devforge/v1/teams/current')
        ->assertSuccessful()
        ->assertJsonPath('data.id', $this->team->id);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->putJson('/api/devforge/v1/teams/current', [
            'name' => 'DevForge Team Updated',
            'description' => 'Updated description',
        ])
        ->assertSuccessful()
        ->assertJsonPath('data.name', 'DevForge Team Updated')
        ->assertJsonPath('data.description', 'Updated description');

    $invitation = $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson('/api/devforge/v1/teams/current/invitations', [
            'email' => 'invited@example.com',
            'role' => 'member',
            'via' => 'link',
        ])
        ->assertCreated()
        ->assertJsonPath('data.email', 'invited@example.com')
        ->assertJsonPath('data.role', 'member');

    $invitationId = $invitation->json('data.id');

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson('/api/devforge/v1/teams/current/invitations')
        ->assertSuccessful()
        ->assertJsonFragment(['email' => 'invited@example.com']);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->deleteJson("/api/devforge/v1/teams/current/invitations/{$invitationId}")
        ->assertNoContent();
});

it('updates and removes team members for admins', function () {
    $member = User::factory()->create();
    $this->team->members()->attach($member, ['role' => 'member']);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->putJson("/api/devforge/v1/teams/current/members/{$member->id}", [
            'role' => 'admin',
        ])
        ->assertSuccessful()
        ->assertJsonPath('data.role', 'admin');

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->deleteJson("/api/devforge/v1/teams/current/members/{$member->id}")
        ->assertNoContent();
});

it('returns masked shared variables notifications and private keys for current team only', function () {
    SharedEnvironmentVariable::query()->create([
        'key' => 'TEAM_SECRET',
        'value' => 'super-secret-value',
        'type' => 'team',
        'team_id' => $this->team->id,
    ]);
    $this->team->discordNotificationSettings()->update([
        'discord_enabled' => true,
        'discord_webhook_url' => 'https://example.test/private-hook',
    ]);
    DB::table('private_keys')->insert([
        'uuid' => (string) Str::uuid(),
        'name' => 'Deployment key',
        'private_key' => 'private-key-material',
        'team_id' => $this->team->id,
        'created_at' => now(),
        'updated_at' => now(),
    ]);

    $variables = $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson('/api/devforge/v1/shared-variables')
        ->assertSuccessful()
        ->assertJsonPath('data.team.0.value', '********');
    expect($variables->getContent())->not->toContain('super-secret-value');

    $notifications = $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson('/api/devforge/v1/notifications')
        ->assertSuccessful();
    $discord = collect($notifications->json('data'))->firstWhere('channel', 'discord');
    expect($discord['credentials']['discord_webhook_url_set'] ?? null)->toBeTrue()
        ->and($discord['credentials'] ?? [])->not->toHaveKey('discord_webhook_url');
    expect($notifications->getContent())->not->toContain('private-hook');

    $keys = $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson('/api/devforge/v1/security/keys')
        ->assertSuccessful()
        ->assertJsonPath('data.0.private_key', '********');
    expect($keys->getContent())->not->toContain('private-key-material');
});

it('forbids instance settings to users without the instance policy permission', function () {
    InstanceSettings::unguarded(fn (): InstanceSettings => InstanceSettings::query()->create(['id' => 0]));

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson('/api/devforge/v1/settings')
        ->assertForbidden();
});

it('returns only whitelisted settings to an instance admin', function () {
    $rootTeam = Team::factory()->create(['id' => 0]);
    $rootTeam->members()->attach($this->user, ['role' => 'admin']);
    InstanceSettings::unguarded(fn (): InstanceSettings => InstanceSettings::query()->create([
        'id' => 0,
        'instance_name' => 'DevForge',
        'smtp_password' => 'must-never-be-returned',
    ]));

    $response = $this->actingAs($this->user)
        ->withSession(['currentTeam' => $rootTeam])
        ->getJson('/api/devforge/v1/settings')
        ->assertSuccessful()
        ->assertJsonPath('data.instance.instance_name', 'DevForge')
        ->assertJsonMissingPath('data.smtp_password')
        ->assertJsonMissingPath('data.email.smtp_password')
        ->assertJsonMissingPath('data.resend_api_key');

    expect($response->getContent())->not->toContain('must-never-be-returned');
});

it('returns masked oauth settings to an instance admin', function () {
    $rootTeam = Team::factory()->create(['id' => 0]);
    $rootTeam->members()->attach($this->user, ['role' => 'admin']);
    InstanceSettings::unguarded(fn (): InstanceSettings => InstanceSettings::query()->create(['id' => 0]));

    OauthSetting::create([
        'provider' => 'github',
        'enabled' => true,
        'client_id' => 'github-client-id',
        'client_secret' => 'github-client-secret',
        'redirect_uri' => 'https://example.test/oauth/github/callback',
    ]);

    $response = $this->actingAs($this->user)
        ->withSession(['currentTeam' => $rootTeam])
        ->getJson('/api/devforge/v1/settings/oauth')
        ->assertSuccessful()
        ->assertJsonPath('data.0.provider', 'github')
        ->assertJsonPath('data.0.client_id', 'github-client-id')
        ->assertJsonPath('data.0.client_secret_set', true)
        ->assertJsonPath('data.0.redirect_uri', 'https://example.test/oauth/github/callback');

    expect($response->getContent())->not->toContain('github-client-secret');
    expect($response->json('data.0'))->not->toHaveKey('client_secret');
});

it('updates notification channel events and enabled flag for the current team', function () {
    $this->team->discordNotificationSettings()->update([
        'discord_enabled' => false,
        'deployment_success_discord_notifications' => false,
        'deployment_failure_discord_notifications' => true,
    ]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->putJson('/api/devforge/v1/notifications/discord', [
            'enabled' => true,
            'events' => [
                'deployment_success_discord_notifications' => true,
                'deployment_failure_discord_notifications' => false,
            ],
        ])
        ->assertSuccessful()
        ->assertJsonPath('data.channel', 'discord')
        ->assertJsonPath('data.enabled', true)
        ->assertJsonPath('data.events.deployment_success_discord_notifications', true)
        ->assertJsonPath('data.events.deployment_failure_discord_notifications', false);

    expect($this->team->discordNotificationSettings()->first())
        ->discord_enabled->toBeTrue()
        ->deployment_success_discord_notifications->toBeTrue()
        ->deployment_failure_discord_notifications->toBeFalse();
});

it('rejects unknown notification event keys', function () {
    $this->actingAs($this->user)
        ->withSession($this->session)
        ->putJson('/api/devforge/v1/notifications/discord', [
            'events' => [
                'not_a_real_event' => true,
            ],
        ])
        ->assertUnprocessable()
        ->assertJsonValidationErrors(['events']);
});

it('updates notification channel credentials without echoing secrets', function () {
    $this->team->discordNotificationSettings()->update([
        'discord_enabled' => true,
        'discord_ping_enabled' => true,
        'discord_webhook_url' => null,
    ]);

    $response = $this->actingAs($this->user)
        ->withSession($this->session)
        ->putJson('/api/devforge/v1/notifications/discord', [
            'credentials' => [
                'discord_ping_enabled' => false,
                'discord_webhook_url' => 'https://discord.com/api/webhooks/99/secret-token',
            ],
        ])
        ->assertSuccessful()
        ->assertJsonPath('data.credentials.discord_ping_enabled', false)
        ->assertJsonPath('data.credentials.discord_webhook_url_set', true)
        ->assertJsonMissingPath('data.credentials.discord_webhook_url');

    expect($response->getContent())->not->toContain('secret-token');
    expect($this->team->discordNotificationSettings()->first())
        ->discord_ping_enabled->toBeFalse()
        ->discord_webhook_url->toBe('https://discord.com/api/webhooks/99/secret-token');
});

it('creates updates and deletes shared variables for the current team', function () {
    $create = $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson('/api/devforge/v1/shared-variables', [
            'key' => 'TEAM_API_KEY',
            'value' => 'secret-value',
            'scope' => 'team',
            'comment' => 'Jeton API',
            'is_literal' => true,
        ])
        ->assertCreated()
        ->assertJsonPath('data.key', 'TEAM_API_KEY')
        ->assertJsonPath('data.scope', 'team')
        ->assertJsonPath('data.value', '********');

    $variableId = $create->json('data.id');
    expect($create->getContent())->not->toContain('secret-value');

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->putJson("/api/devforge/v1/shared-variables/{$variableId}", [
            'comment' => 'Jeton API mis à jour',
            'value' => 'rotated-secret',
        ])
        ->assertSuccessful()
        ->assertJsonPath('data.comment', 'Jeton API mis à jour');

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->deleteJson("/api/devforge/v1/shared-variables/{$variableId}")
        ->assertNoContent();

    expect(SharedEnvironmentVariable::query()->find($variableId))->toBeNull();
});

it('requires an authenticated verified session', function () {
    $this->getJson('/api/devforge/v1/overview')->assertUnauthorized();

    config()->set('constants.coolify.self_hosted', false);
    $unverified = User::factory()->unverified()->create();
    $team = $unverified->teams()->firstOrFail();

    $this->actingAs($unverified)
        ->withSession(['currentTeam' => $team])
        ->getJson('/api/devforge/v1/overview')
        ->assertForbidden();
});
