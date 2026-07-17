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
