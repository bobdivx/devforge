<?php

use App\Models\Environment;
use App\Models\Project;
use App\Models\Server;
use App\Models\StandaloneDocker;
use App\Models\StandaloneLibsql;
use App\Models\User;
use App\Services\DevForge\Database\LibsqlJwtCredentials;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

it('generates ed25519 jwt credentials compatible with bearer auth', function () {
    $credentials = app(LibsqlJwtCredentials::class)->generate();

    expect($credentials['public_key'])->not->toBeEmpty()
        ->and($credentials['secret_key'])->not->toBeEmpty()
        ->and(substr_count($credentials['token'], '.'))->toBe(2);

    $parts = explode('.', $credentials['token']);
    $header = json_decode(base64_decode(strtr($parts[0], '-_', '+/')), true);
    $payload = json_decode(base64_decode(strtr($parts[1], '-_', '+/')), true);

    expect($header['alg'])->toBe('EdDSA')
        ->and($payload['a'])->toBe('rw');
});

it('creates standalone libsql with jwt credentials on first insert', function () {
    $user = User::factory()->create();
    $team = $user->teams()->firstOrFail();
    $server = Server::factory()->create(['team_id' => $team->id]);
    $destination = $server->standaloneDockers()->firstOrFail();
    $project = Project::factory()->create(['team_id' => $team->id]);
    $environment = Environment::factory()->create(['project_id' => $project->id]);

    $database = create_standalone_libsql($environment->id, $destination, [
        'name' => 'Fresh libsql',
    ]);

    expect($database->exists)->toBeTrue()
        ->and($database->libsql_auth_token)->not->toBeEmpty()
        ->and(substr_count((string) $database->libsql_auth_token, '.'))->toBe(2)
        ->and($database->libsql_jwt_public_key)->not->toBeEmpty()
        ->and($database->libsql_jwt_secret_key)->not->toBeEmpty();
});

it('bootstraps jwt keys on legacy libsql databases', function () {
    $user = User::factory()->create();
    $team = $user->teams()->firstOrFail();
    $server = Server::factory()->create(['team_id' => $team->id]);
    $destination = $server->standaloneDockers()->firstOrFail();
    $project = Project::factory()->create(['team_id' => $team->id]);
    $environment = Environment::factory()->create(['project_id' => $project->id]);

    $database = StandaloneLibsql::withoutEvents(fn () => StandaloneLibsql::create([
        'uuid' => fake()->uuid(),
        'name' => 'Legacy db',
        'libsql_auth_user' => 'libsql',
        'libsql_auth_token' => 'legacy-basic-password',
        'status' => 'running:healthy',
        'environment_id' => $environment->id,
        'destination_id' => $destination->id,
        'destination_type' => StandaloneDocker::class,
    ]));

    $changed = app(LibsqlJwtCredentials::class)->ensure($database);
    $database->refresh();

    expect($changed)->toBeTrue()
        ->and($database->libsql_jwt_public_key)->not->toBeEmpty()
        ->and($database->libsql_jwt_secret_key)->not->toBeEmpty()
        ->and(substr_count((string) $database->libsql_auth_token, '.'))->toBe(2)
        ->and($database->libsql_auth_token)->not->toBe('legacy-basic-password');
});

it('reissues jwt tokens from existing keys', function () {
    $service = app(LibsqlJwtCredentials::class);
    $generated = $service->generate();

    $user = User::factory()->create();
    $team = $user->teams()->firstOrFail();
    $server = Server::factory()->create(['team_id' => $team->id]);
    $destination = $server->standaloneDockers()->firstOrFail();
    $project = Project::factory()->create(['team_id' => $team->id]);
    $environment = Environment::factory()->create(['project_id' => $project->id]);

    $database = StandaloneLibsql::withoutEvents(fn () => StandaloneLibsql::create([
        'uuid' => fake()->uuid(),
        'name' => 'Jwt db',
        'libsql_auth_user' => 'libsql',
        'libsql_auth_token' => $generated['token'],
        'libsql_jwt_secret_key' => $generated['secret_key'],
        'libsql_jwt_public_key' => $generated['public_key'],
        'status' => 'running:healthy',
        'environment_id' => $environment->id,
        'destination_id' => $destination->id,
        'destination_type' => StandaloneDocker::class,
    ]));

    $newToken = $service->regenerateToken($database);
    $database->refresh();

    expect($newToken)->not->toBe($generated['token'])
        ->and($database->libsql_auth_token)->toBe($newToken)
        ->and($database->libsql_jwt_public_key)->toBe($generated['public_key']);
});
