<?php

use App\Models\Application;
use App\Models\Environment;
use App\Models\Project;
use App\Models\Server;
use App\Models\StandaloneDocker;
use App\Models\StandaloneLibsql;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Bus;

uses(RefreshDatabase::class);

beforeEach(function () {
    config()->set('devforge.enabled', true);

    $this->user = User::factory()->create();
    $this->team = $this->user->teams()->firstOrFail();
    $this->session = ['currentTeam' => $this->team];

    $this->server = Server::factory()->create([
        'team_id' => $this->team->id,
    ]);
    $this->destination = $this->server->standaloneDockers()->firstOrFail();
    $this->project = Project::factory()->create(['team_id' => $this->team->id]);
    $this->environment = Environment::factory()->create(['project_id' => $this->project->id]);

    $this->database = StandaloneLibsql::withoutEvents(fn () => StandaloneLibsql::create([
        'uuid' => fake()->uuid(),
        'name' => 'Credentials db',
        'libsql_auth_user' => 'libsql',
        'libsql_auth_token' => 'initial-token',
        'status' => 'running:healthy',
        'environment_id' => $this->environment->id,
        'destination_id' => $this->destination->id,
        'destination_type' => StandaloneDocker::class,
    ]));

    $this->application = Application::factory()->create([
        'name' => 'Linked app',
        'environment_id' => $this->environment->id,
        'destination_id' => $this->destination->id,
        'destination_type' => StandaloneDocker::class,
        'git_repository' => 'acme/demo-app',
        'git_branch' => 'main',
    ]);
});

it('returns libsql credentials for authorized users', function () {
    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson("/api/devforge/v1/databases/{$this->database->uuid}/credentials")
        ->assertSuccessful()
        ->assertJsonPath('data.turso_database_url', "http://{$this->database->uuid}:8080")
        ->assertJsonPath('data.turso_auth_token', 'initial-token')
        ->assertJsonPath('data.is_public', false);
});

it('regenerates libsql auth token and syncs linked applications', function () {
    Bus::fake();

    $this->application->environment_variables()->create([
        'key' => 'TURSO_DATABASE_URL',
        'value' => "http://{$this->database->uuid}:8080",
        'comment' => 'devforge:database:'.$this->database->uuid,
        'is_preview' => false,
        'is_runtime' => true,
        'is_buildtime' => true,
    ]);
    $this->application->environment_variables()->create([
        'key' => 'TURSO_AUTH_TOKEN',
        'value' => 'initial-token',
        'comment' => 'devforge:database:'.$this->database->uuid,
        'is_preview' => false,
        'is_runtime' => true,
        'is_buildtime' => true,
    ]);

    $response = $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson("/api/devforge/v1/databases/{$this->database->uuid}/regenerate-token", [
            'redeploy_applications' => false,
        ])
        ->assertSuccessful();

    $newToken = $response->json('data.turso_auth_token');
    expect($newToken)->not->toBe('initial-token')
        ->and(substr_count((string) $newToken, '.'))->toBe(2);

    $this->database->refresh();
    expect($this->database->libsql_auth_token)->toBe($newToken)
        ->and($this->database->libsql_jwt_public_key)->not->toBeEmpty();

    $tokenVar = $this->application->environment_variables()
        ->where('key', 'TURSO_AUTH_TOKEN')
        ->where('is_preview', false)
        ->first();

    expect($tokenVar)->not->toBeNull()
        ->and($tokenVar->value)->toBe($newToken);
});

it('enables public access for libsql databases', function () {
    Bus::fake();

    $this->server->settings->update([
        'wildcard_domain' => 'https://apps.example.com',
    ]);

    $response = $this->actingAs($this->user)
        ->withSession($this->session)
        ->putJson("/api/devforge/v1/databases/{$this->database->uuid}/public-access", [
            'enabled' => true,
            'public_port' => 19080,
            'redeploy_applications' => false,
        ])
        ->assertSuccessful()
        ->assertJsonPath('data.is_public', true)
        ->assertJsonPath('data.public_port', 19080);

    expect($response->json('data.turso_database_url_external'))
        ->toBe('libsql://db-'.$this->database->uuid.'.apps.example.com');
    expect($response->json('data.fqdn'))
        ->toBe('https://db-'.$this->database->uuid.'.apps.example.com');

    $this->database->refresh();
    expect($this->database->is_public)->toBeTrue()
        ->and($this->database->public_port)->toBe(19080)
        ->and($this->database->fqdn)->toBe('https://db-'.$this->database->uuid.'.apps.example.com');
});

it('prefers domain url over ip port for external credentials', function () {
    $this->database->update([
        'is_public' => true,
        'public_port' => 19080,
        'fqdn' => 'https://db-demo.apps.example.com',
    ]);

    $response = $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson("/api/devforge/v1/databases/{$this->database->uuid}/credentials")
        ->assertSuccessful()
        ->assertJsonPath('data.turso_database_url_external', 'libsql://db-demo.apps.example.com')
        ->assertJsonPath('data.external_url', 'libsql://db-demo.apps.example.com')
        ->assertJsonPath('data.libsql_url', "http://{$this->database->uuid}:8080")
        ->assertJsonPath('data.fqdn', 'https://db-demo.apps.example.com');

    expect($response->json('data.external_url'))->not->toContain('initial-token')
        ->and($response->json('data.external_url'))->not->toContain('@')
        ->and($response->json('data.libsql_url'))->not->toContain('@');
});

it('falls back to ip port when public without fqdn', function () {
    $this->database->update([
        'is_public' => true,
        'public_port' => 19080,
        'fqdn' => null,
    ]);

    $response = $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson("/api/devforge/v1/databases/{$this->database->uuid}/credentials")
        ->assertSuccessful();

    expect($response->json('data.turso_database_url_external'))->toEndWith(':19080');
});
