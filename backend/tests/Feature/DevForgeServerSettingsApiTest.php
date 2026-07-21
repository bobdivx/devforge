<?php

use App\Models\Server;
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
});

it('shows server wildcard domain settings', function () {
    $this->server->settings->update([
        'wildcard_domain' => 'https://apps.briseteia.me',
    ]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson("/api/devforge/v1/servers/{$this->server->uuid}/settings")
        ->assertSuccessful()
        ->assertJsonPath('data.uuid', $this->server->uuid)
        ->assertJsonPath('data.wildcard_domain', 'https://apps.briseteia.me');
});

it('updates server wildcard domain settings', function () {
    $this->actingAs($this->user)
        ->withSession($this->session)
        ->putJson("/api/devforge/v1/servers/{$this->server->uuid}/settings", [
            'wildcard_domain' => 'https://apps.example.com/',
        ])
        ->assertSuccessful()
        ->assertJsonPath('data.wildcard_domain', 'https://apps.example.com');

    expect($this->server->settings->fresh()->wildcard_domain)->toBe('https://apps.example.com');
});

it('clears server wildcard domain when null', function () {
    $this->server->settings->update([
        'wildcard_domain' => 'https://apps.example.com',
    ]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->putJson("/api/devforge/v1/servers/{$this->server->uuid}/settings", [
            'wildcard_domain' => null,
        ])
        ->assertSuccessful()
        ->assertJsonPath('data.wildcard_domain', null);

    expect($this->server->settings->fresh()->wildcard_domain)->toBeNull();
});

it('includes wildcard domain in core server resource', function () {
    $this->server->settings->update([
        'wildcard_domain' => 'https://apps.example.com',
    ]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson("/api/devforge/v1/core/servers/{$this->server->uuid}")
        ->assertSuccessful()
        ->assertJsonPath('data.configuration.wildcard_domain', 'https://apps.example.com');
});

it('shows swarm sentinel and proxy settings without leaking sentinel token', function () {
    $this->server->settings->update([
        'is_swarm_manager' => true,
        'is_swarm_worker' => false,
        'is_sentinel_enabled' => true,
        'is_metrics_enabled' => true,
        'sentinel_token' => 'super-secret-sentinel-token',
        'sentinel_push_interval_seconds' => 30,
    ]);
    $this->server->proxy->set('type', 'TRAEFIK');
    $this->server->proxy->set('status', 'running');
    $this->server->proxy->set('redirect_enabled', true);
    $this->server->save();

    $response = $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson("/api/devforge/v1/servers/{$this->server->uuid}/settings")
        ->assertSuccessful()
        ->assertJsonPath('data.swarm.is_swarm_manager', true)
        ->assertJsonPath('data.sentinel.is_sentinel_enabled', true)
        ->assertJsonPath('data.sentinel.sentinel_token_set', true)
        ->assertJsonPath('data.proxy.type', 'TRAEFIK')
        ->assertJsonMissingPath('data.sentinel.sentinel_token');

    expect($response->getContent())->not->toContain('super-secret-sentinel-token');
});

it('updates swarm and sentinel settings for the current team', function () {
    $this->actingAs($this->user)
        ->withSession($this->session)
        ->putJson("/api/devforge/v1/servers/{$this->server->uuid}/settings", [
            'is_swarm_manager' => false,
            'is_swarm_worker' => true,
            'is_sentinel_enabled' => true,
            'is_metrics_enabled' => false,
            'sentinel_push_interval_seconds' => 45,
        ])
        ->assertSuccessful()
        ->assertJsonPath('data.swarm.is_swarm_worker', true)
        ->assertJsonPath('data.sentinel.is_sentinel_enabled', true)
        ->assertJsonPath('data.sentinel.is_metrics_enabled', false)
        ->assertJsonPath('data.sentinel.sentinel_push_interval_seconds', 45);

    expect($this->server->settings->fresh())
        ->is_swarm_manager->toBeFalse()
        ->is_swarm_worker->toBeTrue()
        ->is_sentinel_enabled->toBeTrue()
        ->is_metrics_enabled->toBeFalse()
        ->sentinel_push_interval_seconds->toBe(45);
});

it('rejects wildcard updates for servers from another team', function () {
    $otherTeam = Team::factory()->create();
    $otherUser = User::factory()->create();
    $otherUser->teams()->attach($otherTeam->id, ['role' => 'owner']);

    $this->actingAs($otherUser)
        ->withSession(['currentTeam' => $otherTeam])
        ->putJson("/api/devforge/v1/servers/{$this->server->uuid}/settings", [
            'wildcard_domain' => 'https://evil.example.com',
        ])
        ->assertNotFound();
});
