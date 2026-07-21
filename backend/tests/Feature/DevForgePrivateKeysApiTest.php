<?php

use App\Models\PrivateKey;
use App\Models\Team;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;

uses(RefreshDatabase::class);

beforeEach(function () {
    config()->set('devforge.enabled', true);
    Storage::fake('ssh-keys');

    $this->user = User::factory()->create();
    $this->team = $this->user->teams()->firstOrFail();
    $this->session = ['currentTeam' => $this->team];
});

function validOpenSshPrivateKey(): string
{
    return <<<'KEY'
-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW
QyNTUxOQAAACBbhpqHhqv6aI67Mj9abM3DVbmcfYhZAhC7ca4d9UCevAAAAJi/QySHv0Mk
hwAAAAtzc2gtZWQyNTUxOQAAACBbhpqHhqv6aI67Mj9abM3DVbmcfYhZAhC7ca4d9UCevA
AAAECBQw4jg1WRT2IGHMncCiZhURCts2s24HoDS0thHnnRKVuGmoeGq/pojrsyP1pszcNV
uZx9iFkCELtxrh31QJ68AAAAEXNhaWxANzZmZjY2ZDJlMmRkAQIDBA==
-----END OPENSSH PRIVATE KEY-----
KEY;
}

it('lists private keys without exposing the secret', function () {
    PrivateKey::create([
        'name' => 'Deploy key',
        'description' => 'Prod',
        'private_key' => validOpenSshPrivateKey(),
        'team_id' => $this->team->id,
    ]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson('/api/devforge/v1/security/keys')
        ->assertSuccessful()
        ->assertJsonPath('data.0.name', 'Deploy key')
        ->assertJsonPath('data.0.private_key', '********');
});

it('creates a private key', function () {
    $generated = PrivateKey::generateNewKeyPair('ed25519');

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson('/api/devforge/v1/security/keys', [
            'name' => 'New key',
            'description' => 'Created via DevForge',
            'private_key' => $generated['private_key'],
        ])
        ->assertCreated()
        ->assertJsonPath('data.name', 'New key')
        ->assertJsonPath('data.private_key', '********');

    expect(PrivateKey::query()->where('team_id', $this->team->id)->where('name', 'New key')->exists())->toBeTrue();
});

it('updates and deletes a private key', function () {
    $generated = PrivateKey::generateNewKeyPair('ed25519');
    $key = PrivateKey::createAndStore([
        'name' => 'Editable',
        'description' => 'Old',
        'private_key' => $generated['private_key'],
        'team_id' => $this->team->id,
    ]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->putJson("/api/devforge/v1/security/keys/{$key->uuid}", [
            'name' => 'Renamed',
            'description' => 'Updated',
        ])
        ->assertSuccessful()
        ->assertJsonPath('data.name', 'Renamed');

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->deleteJson("/api/devforge/v1/security/keys/{$key->uuid}")
        ->assertSuccessful();

    expect(PrivateKey::query()->where('uuid', $key->uuid)->exists())->toBeFalse();
});

it('scopes private keys to the current team', function () {
    $otherTeam = Team::factory()->create();
    $generated = PrivateKey::generateNewKeyPair('ed25519');
    $otherKey = PrivateKey::create([
        'name' => 'Other team key',
        'private_key' => $generated['private_key'],
        'team_id' => $otherTeam->id,
    ]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->putJson("/api/devforge/v1/security/keys/{$otherKey->uuid}", [
            'name' => 'Hacked',
        ])
        ->assertNotFound();
});
