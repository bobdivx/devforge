<?php

use App\Models\Server;
use App\Models\Team;
use App\Models\User;
use App\Services\DevForge\Server\ServerPathValidator;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Validation\ValidationException;

uses(RefreshDatabase::class);

beforeEach(function () {
    config()->set('devforge.enabled', true);

    $this->user = User::factory()->create();
    $this->team = $this->user->teams()->firstOrFail();
    $this->server = Server::factory()->create([
        'team_id' => $this->team->id,
        'name' => 'Filesystem host',
    ]);
});

it('exposes server filesystem meta', function () {
    $this->actingAs($this->user)
        ->withSession(['currentTeam' => $this->team])
        ->getJson('/api/devforge/v1/server-files/meta')
        ->assertSuccessful()
        ->assertJsonPath('meta.default_path', ServerPathValidator::DEFAULT_ROOT);
});

it('rejects invalid directory paths', function () {
    $this->actingAs($this->user)
        ->withSession(['currentTeam' => $this->team])
        ->getJson('/api/devforge/v1/server-files/'.$this->server->uuid.'/list?path=/etc/../passwd')
        ->assertUnprocessable()
        ->assertJsonValidationErrors(['path']);
});

it('rejects read without path', function () {
    $this->actingAs($this->user)
        ->withSession(['currentTeam' => $this->team])
        ->getJson('/api/devforge/v1/server-files/'.$this->server->uuid.'/read')
        ->assertUnprocessable()
        ->assertJsonValidationErrors(['path']);
});

it('rejects write payloads missing content', function () {
    $this->actingAs($this->user)
        ->withSession(['currentTeam' => $this->team])
        ->putJson('/api/devforge/v1/server-files/'.$this->server->uuid, [
            'path' => '/data/coolify/test.txt',
        ])
        ->assertUnprocessable()
        ->assertJsonValidationErrors(['content']);
});

it('returns 404 for servers outside the current team', function () {
    $foreignTeam = Team::factory()->create();
    $foreignServer = Server::factory()->create(['team_id' => $foreignTeam->id]);

    $this->actingAs($this->user)
        ->withSession(['currentTeam' => $this->team])
        ->getJson('/api/devforge/v1/server-files/'.$foreignServer->uuid.'/list')
        ->assertNotFound();
});

it('rejects listing when terminal access is disabled', function () {
    $this->server->settings->update(['is_terminal_enabled' => false]);

    $this->actingAs($this->user)
        ->withSession(['currentTeam' => $this->team])
        ->getJson('/api/devforge/v1/server-files/'.$this->server->uuid.'/list')
        ->assertUnprocessable()
        ->assertJsonValidationErrors(['server']);
});

it('validates search mode', function () {
    $this->actingAs($this->user)
        ->withSession(['currentTeam' => $this->team])
        ->getJson('/api/devforge/v1/server-files/'.$this->server->uuid.'/search?pattern=env&mode=invalid')
        ->assertUnprocessable()
        ->assertJsonValidationErrors(['mode']);
});

it('rejects oversized write content at validation layer', function () {
    expect(fn () => app(\App\Services\DevForge\Server\ServerFilesystemService::class)->writeFile(
        $this->team,
        $this->server,
        '/data/coolify/huge.txt',
        str_repeat('a', 40000),
    ))->toThrow(ValidationException::class);
});
