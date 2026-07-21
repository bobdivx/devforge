<?php

use App\Models\InstanceSettings;
use App\Models\Team;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

beforeEach(function () {
    config()->set('devforge.enabled', true);

    InstanceSettings::forceCreate([
        'id' => 0,
        'is_api_enabled' => true,
    ]);

    $this->user = User::factory()->create();
    $this->team = $this->user->teams()->firstOrFail();
    $this->session = ['currentTeam' => $this->team];
});

it('lists api tokens for the current team without leaking secrets', function () {
    $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson('/api/devforge/v1/security/api-tokens', [
            'name' => 'Read token',
            'abilities' => ['read'],
            'expires_in_days' => 30,
        ])
        ->assertCreated();

    $response = $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson('/api/devforge/v1/security/api-tokens')
        ->assertSuccessful()
        ->assertJsonPath('data.0.name', 'Read token')
        ->assertJsonPath('meta.is_api_enabled', true);

    expect($response->json('data.0'))->not->toHaveKey('plain_text_token')
        ->and($response->json('data.0'))->not->toHaveKey('token');
});

it('creates an api token and returns the plain text once', function () {
    $response = $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson('/api/devforge/v1/security/api-tokens', [
            'name' => 'Deploy token',
            'abilities' => ['deploy'],
            'expires_in_days' => 7,
        ])
        ->assertCreated()
        ->assertJsonPath('data.name', 'Deploy token')
        ->assertJsonPath('data.abilities', ['deploy']);

    expect($response->json('data.plain_text_token'))->toBeString()->not->toBeEmpty();
});

it('revokes an api token', function () {
    $create = $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson('/api/devforge/v1/security/api-tokens', [
            'name' => 'Temp token',
            'abilities' => ['read'],
        ])
        ->assertCreated();

    $tokenId = $create->json('data.id');

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->deleteJson("/api/devforge/v1/security/api-tokens/{$tokenId}")
        ->assertSuccessful();

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson('/api/devforge/v1/security/api-tokens')
        ->assertSuccessful()
        ->assertJsonPath('data', []);
});

it('rejects token creation when api is disabled', function () {
    InstanceSettings::get()->update(['is_api_enabled' => false]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson('/api/devforge/v1/security/api-tokens', [
            'name' => 'Blocked',
            'abilities' => ['read'],
        ])
        ->assertStatus(422);
});

it('scopes api tokens to the current team', function () {
    $otherTeam = Team::factory()->create();
    $this->user->teams()->attach($otherTeam->id, ['role' => 'member']);

    $create = $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson('/api/devforge/v1/security/api-tokens', [
            'name' => 'Team A token',
            'abilities' => ['read'],
        ])
        ->assertCreated();

    $tokenId = $create->json('data.id');

    $this->actingAs($this->user)
        ->withSession(['currentTeam' => $otherTeam])
        ->getJson('/api/devforge/v1/security/api-tokens')
        ->assertSuccessful()
        ->assertJsonPath('data', []);

    $this->actingAs($this->user)
        ->withSession(['currentTeam' => $otherTeam])
        ->deleteJson("/api/devforge/v1/security/api-tokens/{$tokenId}")
        ->assertNotFound();
});
