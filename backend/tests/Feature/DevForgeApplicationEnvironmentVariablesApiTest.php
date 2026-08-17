<?php

use App\Models\Application;
use App\Models\Environment;
use App\Models\EnvironmentVariable;
use App\Models\Project;
use App\Models\Server;
use App\Models\StandaloneDocker;
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
    $this->destination = $this->server->standaloneDockers()->firstOrFail();
    $this->project = Project::factory()->create(['team_id' => $this->team->id]);
    $this->environment = Environment::factory()->create(['project_id' => $this->project->id]);

    $this->application = Application::factory()->create([
        'name' => 'Env app',
        'environment_id' => $this->environment->id,
        'destination_id' => $this->destination->id,
        'destination_type' => StandaloneDocker::class,
        'git_repository' => 'acme/demo-app',
        'git_branch' => 'main',
    ]);
});

it('lists application environment variables grouped by scope', function () {
    $this->application->environment_variables()->create([
        'key' => 'APP_ENV',
        'value' => 'production',
        'is_preview' => false,
        'is_runtime' => true,
        'is_buildtime' => true,
    ]);

    $this->application->environment_variables()->create([
        'key' => 'PREVIEW_ONLY',
        'value' => 'preview',
        'is_preview' => true,
        'is_runtime' => true,
        'is_buildtime' => true,
    ]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson("/api/devforge/v1/applications/{$this->application->uuid}/environment-variables")
        ->assertSuccessful()
        ->assertJsonPath('data.production.0.key', 'APP_ENV')
        ->assertJsonPath('data.production.0.value', '********')
        ->assertJsonPath('data.production.0.has_value', true)
        ->assertJsonPath('data.preview.0.key', 'PREVIEW_ONLY')
        ->assertJsonCount(1, 'data.production')
        ->assertJsonCount(1, 'data.preview');
});

it('creates updates and deletes an editable application environment variable', function () {
    $createResponse = $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson("/api/devforge/v1/applications/{$this->application->uuid}/environment-variables", [
            'key' => 'API_TOKEN',
            'value' => 'secret-token',
            'comment' => 'Token API externe',
            'is_runtime' => true,
            'is_buildtime' => false,
        ]);

    $createResponse
        ->assertCreated()
        ->assertJsonPath('data.key', 'API_TOKEN')
        ->assertJsonPath('data.comment', 'Token API externe')
        ->assertJsonPath('data.is_editable', true);

    $envUuid = $createResponse->json('data.uuid');

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->putJson("/api/devforge/v1/applications/{$this->application->uuid}/environment-variables/{$envUuid}", [
            'value' => 'updated-token',
            'comment' => 'Token mis à jour',
            'is_buildtime' => true,
        ])
        ->assertSuccessful()
        ->assertJsonPath('data.comment', 'Token mis à jour')
        ->assertJsonPath('data.is_buildtime', true);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->deleteJson("/api/devforge/v1/applications/{$this->application->uuid}/environment-variables/{$envUuid}")
        ->assertSuccessful()
        ->assertJsonPath('message', 'Variable d’environnement supprimée.');

    expect(EnvironmentVariable::query()->where('uuid', $envUuid)->exists())->toBeFalse();
});

it('rejects updates on automatically managed variables', function () {
    $variable = $this->application->environment_variables()->create([
        'key' => 'DATABASE_URL',
        'value' => 'postgres://example',
        'comment' => 'devforge:database:'.fake()->uuid(),
        'is_preview' => false,
        'is_runtime' => true,
        'is_buildtime' => true,
    ]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->putJson("/api/devforge/v1/applications/{$this->application->uuid}/environment-variables/{$variable->uuid}", [
            'value' => 'postgres://changed',
        ])
        ->assertStatus(422)
        ->assertJsonPath('message', 'Cette variable est gérée automatiquement et ne peut pas être modifiée.');
});

it('allows updating and deleting NIXPACKS_NODE_VERSION', function () {
    $variable = $this->application->environment_variables()
        ->where('key', 'NIXPACKS_NODE_VERSION')
        ->where('is_preview', false)
        ->firstOrFail();

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson("/api/devforge/v1/applications/{$this->application->uuid}/environment-variables")
        ->assertSuccessful()
        ->assertJsonPath('data.production.0.key', 'NIXPACKS_NODE_VERSION')
        ->assertJsonPath('data.production.0.is_buildpack_control', true)
        ->assertJsonPath('data.production.0.is_editable', true)
        ->assertJsonPath('data.production.0.is_deletable', true);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->putJson("/api/devforge/v1/applications/{$this->application->uuid}/environment-variables/{$variable->uuid}", [
            'value' => '16',
        ])
        ->assertSuccessful()
        ->assertJsonPath('data.key', 'NIXPACKS_NODE_VERSION');

    expect($variable->fresh()->value)->toBe('16');

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->deleteJson("/api/devforge/v1/applications/{$this->application->uuid}/environment-variables/{$variable->uuid}")
        ->assertSuccessful()
        ->assertJsonPath('message', 'Variable d’environnement supprimée.');

    expect(EnvironmentVariable::query()->where('uuid', $variable->uuid)->exists())->toBeFalse();
});

it('rejects deleting database-linked automatically managed variables', function () {
    $variable = $this->application->environment_variables()->create([
        'key' => 'DATABASE_URL',
        'value' => 'postgres://example',
        'comment' => 'devforge:database:'.fake()->uuid(),
        'is_preview' => false,
        'is_runtime' => true,
        'is_buildtime' => true,
    ]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->deleteJson("/api/devforge/v1/applications/{$this->application->uuid}/environment-variables/{$variable->uuid}")
        ->assertStatus(422)
        ->assertJsonPath('message', 'Cette variable est gérée automatiquement et ne peut pas être supprimée.');
});

it('reveals a stored application environment variable value on demand', function () {
    $variable = $this->application->environment_variables()->create([
        'key' => 'API_TOKEN',
        'value' => 'secret-token',
        'is_preview' => false,
        'is_runtime' => true,
        'is_buildtime' => true,
    ]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson("/api/devforge/v1/applications/{$this->application->uuid}/environment-variables/{$variable->uuid}/reveal")
        ->assertSuccessful()
        ->assertJsonPath('data.uuid', $variable->uuid)
        ->assertJsonPath('data.value', 'secret-token');
});

it('rejects reveal for variables marked as shown once', function () {
    $variable = $this->application->environment_variables()->create([
        'key' => 'ONE_TIME_SECRET',
        'value' => 'secret-token',
        'is_preview' => false,
        'is_runtime' => true,
        'is_buildtime' => true,
        'is_shown_once' => true,
    ]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson("/api/devforge/v1/applications/{$this->application->uuid}/environment-variables/{$variable->uuid}/reveal")
        ->assertForbidden()
        ->assertJsonPath('message', 'Cette valeur ne peut plus être affichée.');
});

it('imports a dotenv file into production and updates existing keys', function () {
    $this->application->environment_variables()->create([
        'key' => 'APP_ENV',
        'value' => 'staging',
        'is_preview' => false,
        'is_runtime' => true,
        'is_buildtime' => true,
    ]);

    $contents = <<<'ENV'
# commentaire
APP_ENV=production
export TURSO_DATABASE_URL=libsql://example.turso.io
JWT_SECRET="super secret"
NIXPACKS_NODE_VERSION=20
ENV;

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson("/api/devforge/v1/applications/{$this->application->uuid}/environment-variables/import", [
            'contents' => $contents,
            'is_preview' => false,
        ])
        ->assertSuccessful()
        ->assertJsonPath('data.created', 2)
        ->assertJsonPath('data.updated', 2);

    expect($this->application->environment_variables()->where('key', 'APP_ENV')->where('is_preview', false)->first()?->value)
        ->toBe('production')
        ->and($this->application->environment_variables()->where('key', 'NIXPACKS_NODE_VERSION')->where('is_preview', false)->first()?->value)
        ->toBe('20')
        ->and($this->application->environment_variables()->where('key', 'TURSO_DATABASE_URL')->where('is_preview', false)->first()?->value)
        ->toBe('libsql://example.turso.io')
        ->and($this->application->environment_variables()->where('key', 'JWT_SECRET')->where('is_preview', false)->first()?->value)
        ->toBe('super secret');
});

it('imports a windows-style dotenv with bom export and spaced equals', function () {
    $contents = "\u{FEFF}export TURSO_DATABASE_URL = libsql://example.turso.io\r\nJWT_SECRET=\"super secret\"\r\nSITE_LOGIN_REQUIRED: true\n";

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson("/api/devforge/v1/applications/{$this->application->uuid}/environment-variables/import", [
            'contents' => $contents,
            'is_preview' => false,
        ])
        ->assertSuccessful()
        ->assertJsonPath('data.created', 3)
        ->assertJsonPath('data.updated', 0);

    expect($this->application->environment_variables()->where('key', 'TURSO_DATABASE_URL')->where('is_preview', false)->first()?->value)
        ->toBe('libsql://example.turso.io')
        ->and($this->application->environment_variables()->where('key', 'JWT_SECRET')->where('is_preview', false)->first()?->value)
        ->toBe('super secret')
        ->and($this->application->environment_variables()->where('key', 'SITE_LOGIN_REQUIRED')->where('is_preview', false)->first()?->value)
        ->toBe('true');
});

it('rejects an empty dotenv import', function () {
    $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson("/api/devforge/v1/applications/{$this->application->uuid}/environment-variables/import", [
            'contents' => "# only comments\n\n",
        ])
        ->assertStatus(422)
        ->assertJsonValidationErrors(['contents']);
});

it('returns not found for variables belonging to another team application', function () {
    $otherTeam = Team::factory()->create();
    $otherProject = Project::factory()->create(['team_id' => $otherTeam->id]);
    $otherEnvironment = Environment::factory()->create(['project_id' => $otherProject->id]);
    $otherApplication = Application::factory()->create([
        'environment_id' => $otherEnvironment->id,
        'destination_id' => $this->destination->id,
        'destination_type' => StandaloneDocker::class,
    ]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson("/api/devforge/v1/applications/{$otherApplication->uuid}/environment-variables")
        ->assertNotFound();
});
