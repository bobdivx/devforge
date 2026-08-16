<?php

use App\Models\InstanceSettings;
use App\Models\S3Storage;
use App\Models\ScheduledDatabaseBackup;
use App\Models\Server;
use App\Models\StandaloneDocker;
use App\Models\StandalonePostgresql;
use App\Models\Team;
use App\Models\User;
use App\Services\DevForge\Backup\EnsureInstanceS3Backup;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;

uses(RefreshDatabase::class);

beforeEach(function () {
    config()->set('devforge.enabled', true);
    config()->set('devforge.backup_s3.enabled', true);
    config()->set('devforge.backup_s3.attach_new_backups', true);
    config()->set('devforge.backup_s3.name', 'Scaleway backups');
    config()->set('devforge.backup_s3.key', 'SCWTESTKEY');
    config()->set('devforge.backup_s3.secret', 'scw-test-secret');
    config()->set('devforge.backup_s3.bucket', 'devforge');
    config()->set('devforge.backup_s3.region', 'fr-par');
    config()->set('devforge.backup_s3.endpoint', 'https://devforge.s3.fr-par.scw.cloud');

    $this->user = User::factory()->create([
        'password' => Hash::make('secret-password'),
    ]);
    $this->rootTeam = Team::factory()->create(['id' => 0]);
    $this->rootTeam->members()->attach($this->user, ['role' => 'admin']);

    InstanceSettings::unguarded(fn (): InstanceSettings => InstanceSettings::query()->create([
        'id' => 0,
        'instance_name' => 'DevForge',
    ]));

    Server::factory()->create([
        'id' => 0,
        'name' => 'localhost',
        'ip' => '127.0.0.1',
    ]);
});

it('skips provisioning when s3 backups are disabled', function () {
    config()->set('devforge.backup_s3.enabled', false);

    $result = app(EnsureInstanceS3Backup::class)->sync(testConnection: false);

    expect($result['status'])->toBe('skipped')
        ->and(S3Storage::query()->count())->toBe(0);
});

it('creates a usable scaleway destination from env and attaches instance backups', function () {
    $database = StandalonePostgresql::create([
        'id' => 0,
        'name' => 'coolify-db',
        'description' => 'DevForge database',
        'postgres_user' => 'devforge',
        'postgres_password' => 'password',
        'postgres_db' => 'devforge',
        'status' => 'running',
        'destination_type' => StandaloneDocker::class,
        'destination_id' => 0,
        'environment_id' => 1,
    ]);

    ScheduledDatabaseBackup::create([
        'id' => 0,
        'enabled' => true,
        'save_s3' => false,
        'frequency' => '0 0 * * *',
        'database_id' => $database->id,
        'database_type' => StandalonePostgresql::class,
        'team_id' => 0,
    ]);

    $this->artisan('devforge:ensure-s3-backup', ['--skip-test' => true])
        ->assertSuccessful();

    $storage = S3Storage::query()->where('uuid', EnsureInstanceS3Backup::STORAGE_UUID_PREFIX)->first();

    expect($storage)->not->toBeNull()
        ->and($storage->endpoint)->toBe('https://s3.fr-par.scw.cloud')
        ->and($storage->bucket)->toBe('devforge')
        ->and($storage->region)->toBe('fr-par')
        ->and($storage->is_usable)->toBeTrue()
        ->and($storage->team_id)->toBe(0);

    $backup = ScheduledDatabaseBackup::find(0);

    expect($backup->save_s3)->toBeTrue()
        ->and($backup->s3_storage_id)->toBe($storage->id);
});

it('does not overwrite an existing s3 destination on a backup', function () {
    $other = S3Storage::unguarded(fn (): S3Storage => S3Storage::create([
        'name' => 'Manual bucket',
        'region' => 'nl-ams',
        'key' => 'other-key',
        'secret' => 'other-secret',
        'bucket' => 'other',
        'endpoint' => 'https://s3.nl-ams.scw.cloud',
        'team_id' => 0,
        'is_usable' => true,
    ]));

    $database = StandalonePostgresql::create([
        'id' => 0,
        'name' => 'coolify-db',
        'postgres_user' => 'devforge',
        'postgres_password' => 'password',
        'postgres_db' => 'devforge',
        'status' => 'running',
        'destination_type' => StandaloneDocker::class,
        'destination_id' => 0,
        'environment_id' => 1,
    ]);

    ScheduledDatabaseBackup::create([
        'id' => 0,
        'enabled' => true,
        'save_s3' => true,
        's3_storage_id' => $other->id,
        'frequency' => '0 0 * * *',
        'database_id' => $database->id,
        'database_type' => StandalonePostgresql::class,
        'team_id' => 0,
    ]);

    app(EnsureInstanceS3Backup::class)->sync(testConnection: false);

    expect(ScheduledDatabaseBackup::find(0)->s3_storage_id)->toBe($other->id);
});
