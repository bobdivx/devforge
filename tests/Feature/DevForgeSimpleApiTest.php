<?php

use App\Models\InstanceSettings;
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
    expect($notifications->getContent())->not->toContain('private-hook')
        ->not->toContain('webhook_url');

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
        ->assertJsonPath('data.instance_name', 'DevForge')
        ->assertJsonMissingPath('data.smtp_password')
        ->assertJsonMissingPath('data.resend_api_key');

    expect($response->getContent())->not->toContain('must-never-be-returned');
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
