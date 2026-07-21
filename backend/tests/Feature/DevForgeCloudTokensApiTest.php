<?php

use App\Models\CloudProviderToken;
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
});

it('lists cloud tokens without leaking secrets', function () {
    CloudProviderToken::query()->create([
        'team_id' => $this->team->id,
        'provider' => 'hetzner',
        'token' => 'secret-token-value',
        'name' => 'Hetzner prod',
    ]);

    $response = $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson('/api/devforge/v1/security/cloud-tokens')
        ->assertSuccessful()
        ->assertJsonPath('data.0.name', 'Hetzner prod')
        ->assertJsonPath('data.0.provider', 'hetzner')
        ->assertJsonPath('data.0.servers_count', 0);

    expect($response->json('data.0'))->not->toHaveKey('token');
});

it('creates a cloud token after provider validation', function () {
    Http::fake([
        'https://api.hetzner.cloud/v1/servers' => Http::response([], 200),
    ]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson('/api/devforge/v1/security/cloud-tokens', [
            'provider' => 'hetzner',
            'token' => 'valid-hetzner-token',
            'name' => 'My Hetzner',
        ])
        ->assertCreated()
        ->assertJsonPath('data.name', 'My Hetzner')
        ->assertJsonPath('data.provider', 'hetzner');

    expect(CloudProviderToken::query()->where('team_id', $this->team->id)->where('name', 'My Hetzner')->exists())->toBeTrue();
});

it('rejects invalid cloud tokens', function () {
    Http::fake([
        'https://api.hetzner.cloud/v1/servers' => Http::response(['error' => 'unauthorized'], 401),
    ]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson('/api/devforge/v1/security/cloud-tokens', [
            'provider' => 'hetzner',
            'token' => 'bad-token',
            'name' => 'Bad',
        ])
        ->assertStatus(422);
});

it('updates renames and deletes a cloud token', function () {
    Http::fake([
        'https://api.hetzner.cloud/v1/servers' => Http::response([], 200),
    ]);

    $token = CloudProviderToken::query()->create([
        'team_id' => $this->team->id,
        'provider' => 'hetzner',
        'token' => 'secret',
        'name' => 'Old name',
    ]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->putJson("/api/devforge/v1/security/cloud-tokens/{$token->uuid}", [
            'name' => 'New name',
        ])
        ->assertSuccessful()
        ->assertJsonPath('data.name', 'New name');

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson("/api/devforge/v1/security/cloud-tokens/{$token->uuid}/validate")
        ->assertSuccessful()
        ->assertJsonPath('data.valid', true);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->deleteJson("/api/devforge/v1/security/cloud-tokens/{$token->uuid}")
        ->assertSuccessful();

    expect(CloudProviderToken::query()->where('uuid', $token->uuid)->exists())->toBeFalse();
});

it('scopes cloud tokens to the current team', function () {
    $otherTeam = Team::factory()->create();
    $otherToken = CloudProviderToken::query()->create([
        'team_id' => $otherTeam->id,
        'provider' => 'hetzner',
        'token' => 'other-secret',
        'name' => 'Other',
    ]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson('/api/devforge/v1/security/cloud-tokens')
        ->assertSuccessful()
        ->assertJsonPath('data', []);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->deleteJson("/api/devforge/v1/security/cloud-tokens/{$otherToken->uuid}")
        ->assertNotFound();
});
