<?php

use App\Models\Application;
use App\Models\EnvironmentVariable;
use App\Models\StandaloneLibsql;
use App\Services\DevForge\Application\ApplicationDatabaseConnector;
use App\Services\DevForge\Database\LibsqlConnectionEnvSync;

beforeEach(function () {
    $this->user = createUser();
    $this->team = $this->user->currentTeam;
    $this->project = createProject($this->team);
    $this->environment = $this->project->environments->first();
    $this->destination = createDestination($this->team);
    
    $this->application = Application::factory()->create([
        'name' => 'Test App',
        'environment_id' => $this->environment->id,
        'destination_type' => $this->destination->getMorphClass(),
        'destination_id' => $this->destination->id,
    ]);
    
    $this->tursoDatabase = StandaloneLibsql::factory()->create([
        'name' => 'Test Turso DB',
        'environment_id' => $this->environment->id,
        'destination_type' => $this->destination->getMorphClass(),
        'destination_id' => $this->destination->id,
    ]);
});

it('detects turso database connection with proper comment marker', function () {
    $comment = LibsqlConnectionEnvSync::LINK_COMMENT_PREFIX . $this->tursoDatabase->uuid;
    
    EnvironmentVariable::factory()->create([
        'key' => 'TURSO_DATABASE_URL',
        'value' => 'http://test:8080',
        'comment' => $comment,
        'is_preview' => false,
        'resourceable_type' => $this->application->getMorphClass(),
        'resourceable_id' => $this->application->id,
    ]);
    
    $connector = app(ApplicationDatabaseConnector::class);
    $connections = $connector->connections($this->application);
    
    expect($connections)->toHaveCount(1)
        ->and($connections[0]['database_uuid'])->toBe($this->tursoDatabase->uuid);
});

it('detects turso database connection without comment marker (legacy apps)', function () {
    // Simulate a legacy app with Turso env vars but no comment marker
    EnvironmentVariable::factory()->create([
        'key' => 'TURSO_DATABASE_URL',
        'value' => 'http://' . $this->tursoDatabase->uuid . ':8080',
        'comment' => null,
        'is_preview' => false,
        'resourceable_type' => $this->application->getMorphClass(),
        'resourceable_id' => $this->application->id,
    ]);
    
    EnvironmentVariable::factory()->create([
        'key' => 'TURSO_AUTH_TOKEN',
        'value' => 'test-token',
        'comment' => null,
        'is_preview' => false,
        'resourceable_type' => $this->application->getMorphClass(),
        'resourceable_id' => $this->application->id,
    ]);
    
    $connector = app(ApplicationDatabaseConnector::class);
    $connections = $connector->connections($this->application);
    
    // Should detect the Turso database by parsing the URL
    expect($connections)->toHaveCount(1)
        ->and($connections[0]['database_uuid'])->toBe($this->tursoDatabase->uuid);
});

it('detects external turso cloud connection when no devforge resource exists', function () {
    // Simulate an app using Turso Cloud (no DevForge StandaloneLibsql resource)
    EnvironmentVariable::factory()->create([
        'key' => 'TURSO_DATABASE_URL',
        'value' => 'libsql://mydb-orgname.turso.io',
        'comment' => null,
        'is_preview' => false,
        'is_runtime' => true,
        'resourceable_type' => $this->application->getMorphClass(),
        'resourceable_id' => $this->application->id,
    ]);
    
    EnvironmentVariable::factory()->create([
        'key' => 'TURSO_AUTH_TOKEN',
        'value' => 'eyJhb...',
        'comment' => null,
        'is_preview' => false,
        'is_runtime' => true,
        'resourceable_type' => $this->application->getMorphClass(),
        'resourceable_id' => $this->application->id,
    ]);
    
    $connector = app(ApplicationDatabaseConnector::class);
    $connections = $connector->connections($this->application);
    
    // Should detect external Turso connection
    expect($connections)->toHaveCount(1)
        ->and($connections[0]['database_uuid'])->toBe('external-turso')
        ->and($connections[0]['external'])->toBeTrue()
        ->and($connections[0]['engine'])->toBe('libsql')
        ->and($connections[0]['display_name'])->toBe('mydb-orgname')
        ->and($connections[0]['env_keys'])->toContain('TURSO_DATABASE_URL')
        ->and($connections[0]['env_keys'])->toContain('TURSO_AUTH_TOKEN');
});

it('does not confuse devforge local turso db with app turso db', function () {
    // Simulate DevForge's local Turso DB env vars (different UUID pattern)
    EnvironmentVariable::factory()->create([
        'key' => 'TURSO_DATABASE_URL',
        'value' => 'http://devforge-local-db:8080',  // Not a resource UUID
        'comment' => null,
        'is_preview' => false,
        'resourceable_type' => $this->application->getMorphClass(),
        'resourceable_id' => $this->application->id,
    ]);
    
    $connector = app(ApplicationDatabaseConnector::class);
    $connections = $connector->connections($this->application);
    
    // Should NOT detect any connection since it's not a real Turso resource
    expect($connections)->toHaveCount(0);
});

it('does not detect local file database as external turso', function () {
    EnvironmentVariable::factory()->create([
        'key' => 'DATABASE_URL',
        'value' => 'file:./local.db',
        'comment' => null,
        'is_preview' => false,
        'resourceable_type' => $this->application->getMorphClass(),
        'resourceable_id' => $this->application->id,
    ]);
    
    $connector = app(ApplicationDatabaseConnector::class);
    $connections = $connector->connections($this->application);
    
    expect($connections)->toHaveCount(0);
});

it('detects turso database from libsql_url with resource uuid', function () {
    // Some apps use LIBSQL_URL instead of TURSO_DATABASE_URL
    EnvironmentVariable::factory()->create([
        'key' => 'LIBSQL_URL',
        'value' => 'http://' . $this->tursoDatabase->uuid . ':8080',
        'comment' => null,
        'is_preview' => false,
        'resourceable_type' => $this->application->getMorphClass(),
        'resourceable_id' => $this->application->id,
    ]);
    
    $connector = app(ApplicationDatabaseConnector::class);
    $connections = $connector->connections($this->application);
    
    expect($connections)->toHaveCount(1)
        ->and($connections[0]['database_uuid'])->toBe($this->tursoDatabase->uuid);
});

it('prioritizes devforge resource over external turso when both exist', function () {
    // Create a proper DevForge resource connection
    $comment = LibsqlConnectionEnvSync::LINK_COMMENT_PREFIX . $this->tursoDatabase->uuid;
    
    EnvironmentVariable::factory()->create([
        'key' => 'TURSO_DATABASE_URL',
        'value' => 'http://test:8080',
        'comment' => $comment,
        'is_preview' => false,
        'resourceable_type' => $this->application->getMorphClass(),
        'resourceable_id' => $this->application->id,
    ]);
    
    // Also add external Turso vars
    EnvironmentVariable::factory()->create([
        'key' => 'PUBLIC_TURSO_DATABASE_URL',
        'value' => 'libsql://public-db.turso.io',
        'comment' => null,
        'is_preview' => false,
        'resourceable_type' => $this->application->getMorphClass(),
        'resourceable_id' => $this->application->id,
    ]);
    
    $connector = app(ApplicationDatabaseConnector::class);
    $connections = $connector->connections($this->application);
    
    // Should only detect the DevForge resource, not the external one
    expect($connections)->toHaveCount(1)
        ->and($connections[0]['database_uuid'])->toBe($this->tursoDatabase->uuid)
        ->and($connections[0]['external'] ?? false)->toBeFalse();
});
