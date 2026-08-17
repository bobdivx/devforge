<?php

use App\Jobs\DatabaseBackupJob;
use App\Models\InstanceSettings;
use App\Models\S3Storage;
use App\Models\ScheduledDatabaseBackup;
use App\Models\ScheduledDatabaseBackupExecution;
use App\Models\Server;
use App\Models\StandaloneDocker;
use App\Models\StandalonePostgresql;
use App\Models\Team;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Queue;

uses(RefreshDatabase::class);

beforeEach(function () {
    config()->set('devforge.enabled', true);

    $this->user = User::factory()->create([
        'password' => Hash::make('secret-password'),
    ]);
    $this->rootTeam = Team::factory()->create(['id' => 0]);
    $this->rootTeam->members()->attach($this->user, ['role' => 'admin']);
    $this->session = ['currentTeam' => $this->rootTeam];

    InstanceSettings::unguarded(fn (): InstanceSettings => InstanceSettings::query()->create([
        'id' => 0,
        'instance_name' => 'DevForge',
    ]));

    $this->server = Server::factory()->create([
        'id' => 0,
        'name' => 'localhost',
        'ip' => '127.0.0.1',
    ]);
});

function seedInstanceDatabase(): StandalonePostgresql
{
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

    return $database;
}

it('can fetch instance backup configuration when none is set', function () {
    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson('/api/devforge/v1/settings/backup')
        ->assertSuccessful()
        ->assertJsonPath('data.database', null)
        ->assertJsonPath('data.backup', null)
        ->assertJsonPath('data.is_server_functional', false)
        ->assertJsonStructure([
            'data' => [
                'executions',
                's3_storages',
                'migration' => ['legacy_container_detected', 'container_candidates', 'notes'],
            ],
        ]);
});

it('can update instance backup database details', function () {
    seedInstanceDatabase();

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->putJson('/api/devforge/v1/settings/backup/database', [
            'name' => 'devforge-db-new',
            'description' => 'New description',
            'postgres_user' => 'newuser',
            'postgres_password' => 'newpassword',
        ])
        ->assertSuccessful()
        ->assertJsonPath('data.database.name', 'devforge-db-new');
});

it('can update instance backup schedule with s3 destination', function () {
    seedInstanceDatabase();

    $storage = S3Storage::create([
        'name' => 'Backups bucket',
        'region' => 'us-east-1',
        'key' => 'test-key',
        'secret' => 'test-secret',
        'bucket' => 'test-bucket',
        'endpoint' => 'https://s3.example.com',
        'is_usable' => true,
        'team_id' => 0,
    ]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->putJson('/api/devforge/v1/settings/backup/schedule', [
            'enabled' => true,
            'frequency' => '0 3 * * *',
            'save_s3' => true,
            's3_storage_uuid' => $storage->uuid,
        ])
        ->assertSuccessful()
        ->assertJsonPath('data.backup.frequency', '0 3 * * *')
        ->assertJsonPath('data.backup.save_s3', true)
        ->assertJsonPath('data.backup.s3_storage.uuid', $storage->uuid);

    expect(ScheduledDatabaseBackup::find(0)->s3_storage_id)->toBe($storage->id);
});

it('queues an instance backup run', function () {
    Queue::fake();
    seedInstanceDatabase();

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson('/api/devforge/v1/settings/backup/run')
        ->assertSuccessful()
        ->assertJsonPath('data.queued', true);

    Queue::assertPushed(DatabaseBackupJob::class);
});

it('returns export metadata for the latest local execution', function () {
    seedInstanceDatabase();

    $backup = ScheduledDatabaseBackup::find(0);
    ScheduledDatabaseBackupExecution::create([
        'scheduled_database_backup_id' => $backup->id,
        'filename' => '/data/devforge/backups/instance.sql.gz',
        'status' => 'success',
        'size' => 1234,
    ]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson('/api/devforge/v1/settings/backup/export')
        ->assertSuccessful()
        ->assertJsonPath('data.filename', '/data/devforge/backups/instance.sql.gz')
        ->assertJsonStructure(['data' => ['execution_id', 'download_url', 'filename']]);
});

it('can fetch instance backup settings when executions have finished_at', function () {
    seedInstanceDatabase();

    $backup = ScheduledDatabaseBackup::find(0);
    ScheduledDatabaseBackupExecution::create([
        'scheduled_database_backup_id' => $backup->id,
        'filename' => '/data/devforge/backups/instance.sql.gz',
        'status' => 'success',
        'size' => 1234,
        'finished_at' => now(),
    ]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson('/api/devforge/v1/settings/backup')
        ->assertSuccessful()
        ->assertJsonPath('data.database.name', 'coolify-db')
        ->assertJsonCount(1, 'data.executions')
        ->assertJsonStructure([
            'data' => [
                'executions' => [
                    ['uuid', 'status', 'finished_at', 'created_at'],
                ],
            ],
        ]);
});

it('hides local download when the dump was deleted after s3 upload', function () {
    seedInstanceDatabase();

    $backup = ScheduledDatabaseBackup::find(0);
    ScheduledDatabaseBackupExecution::create([
        'scheduled_database_backup_id' => $backup->id,
        'filename' => '/media/Docker/AppData/devforge/data/backups/coolify/devforge-db-hostdockerinternal/pg-dump-devforge-1786985338.dmp',
        'status' => 'success',
        'size' => 3232086,
        's3_uploaded' => true,
        'local_storage_deleted' => true,
    ]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson('/api/devforge/v1/settings/backup')
        ->assertSuccessful()
        ->assertJsonPath('data.executions.0.s3_uploaded', true)
        ->assertJsonPath('data.executions.0.local_storage_deleted', true)
        ->assertJsonPath('data.executions.0.download_url', null);
});

it('rejects local export when only s3 copies remain', function () {
    seedInstanceDatabase();

    $backup = ScheduledDatabaseBackup::find(0);
    $backup->update(['disable_local_backup' => true, 'save_s3' => true]);
    ScheduledDatabaseBackupExecution::create([
        'scheduled_database_backup_id' => $backup->id,
        'filename' => '/data/devforge/backups/instance.sql.gz',
        'status' => 'success',
        'size' => 1234,
        's3_uploaded' => true,
        'local_storage_deleted' => true,
    ]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson('/api/devforge/v1/settings/backup/export')
        ->assertStatus(404)
        ->assertJsonPath('error', 'Aucune copie locale à exporter : les dumps sont uniquement sur S3.');
});

it('rejects invalid instance backup import files', function () {
    seedInstanceDatabase();

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->post('/api/devforge/v1/settings/backup/import', [
            'file' => UploadedFile::fake()->create('notes.txt', 10, 'text/plain'),
            'from_coolify' => true,
        ])
        ->assertStatus(422);
});

it('can delete a failed instance backup execution', function () {
    seedInstanceDatabase();

    $backup = ScheduledDatabaseBackup::find(0);
    $execution = ScheduledDatabaseBackupExecution::create([
        'scheduled_database_backup_id' => $backup->id,
        'filename' => null,
        'status' => 'failed',
        'message' => 'No such container: coolify-db',
        'size' => 0,
    ]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->deleteJson('/api/devforge/v1/settings/backup/executions/'.$execution->uuid)
        ->assertSuccessful()
        ->assertJsonCount(0, 'data.executions');

    expect(ScheduledDatabaseBackupExecution::find($execution->id))->toBeNull();
});

it('rejects deleting a running instance backup execution', function () {
    seedInstanceDatabase();

    $backup = ScheduledDatabaseBackup::find(0);
    $execution = ScheduledDatabaseBackupExecution::create([
        'scheduled_database_backup_id' => $backup->id,
        'filename' => null,
        'status' => 'running',
        'size' => 0,
    ]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->deleteJson('/api/devforge/v1/settings/backup/executions/'.$execution->uuid)
        ->assertStatus(422)
        ->assertJsonPath('error', 'Impossible de supprimer une sauvegarde en cours.');

    expect(ScheduledDatabaseBackupExecution::find($execution->id))->not->toBeNull();
});

it('can purge all failed instance backup executions', function () {
    seedInstanceDatabase();

    $backup = ScheduledDatabaseBackup::find(0);
    ScheduledDatabaseBackupExecution::create([
        'scheduled_database_backup_id' => $backup->id,
        'filename' => null,
        'status' => 'failed',
        'size' => 0,
    ]);
    ScheduledDatabaseBackupExecution::create([
        'scheduled_database_backup_id' => $backup->id,
        'filename' => null,
        'status' => 'failed',
        'size' => 0,
    ]);
    $success = ScheduledDatabaseBackupExecution::create([
        'scheduled_database_backup_id' => $backup->id,
        'filename' => '/data/devforge/backups/instance.sql.gz',
        'status' => 'success',
        'size' => 1234,
    ]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->deleteJson('/api/devforge/v1/settings/backup/executions/failed')
        ->assertSuccessful()
        ->assertJsonCount(1, 'data.executions')
        ->assertJsonPath('data.executions.0.uuid', $success->uuid);

    expect(ScheduledDatabaseBackupExecution::where('status', 'failed')->count())->toBe(0)
        ->and(ScheduledDatabaseBackupExecution::find($success->id))->not->toBeNull();
});

it('enables s3 on instance backup when a destination already exists', function () {
    seedInstanceDatabase();

    $storage = S3Storage::create([
        'name' => 'Backups bucket',
        'region' => 'us-east-1',
        'key' => 'test-key',
        'secret' => 'test-secret',
        'bucket' => 'test-bucket',
        'endpoint' => 'https://s3.example.com',
        'is_usable' => true,
        'team_id' => 0,
    ]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson('/api/devforge/v1/settings/backup')
        ->assertSuccessful()
        ->assertJsonPath('data.backup.save_s3', true)
        ->assertJsonPath('data.backup.s3_storage.uuid', $storage->uuid);

    $backup = ScheduledDatabaseBackup::find(0);

    expect($backup->save_s3)->toBeTrue()
        ->and($backup->s3_storage_id)->toBe($storage->id);
});

it('attaches a configured s3 destination even when it is not marked usable yet', function () {
    seedInstanceDatabase();

    $storage = S3Storage::create([
        'name' => 'Untested bucket',
        'region' => 'us-east-1',
        'key' => 'test-key',
        'secret' => 'test-secret',
        'bucket' => 'test-bucket',
        'endpoint' => 'https://s3.example.com',
        'is_usable' => false,
        'team_id' => 0,
    ]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson('/api/devforge/v1/settings/backup')
        ->assertSuccessful()
        ->assertJsonPath('data.backup.save_s3', true)
        ->assertJsonPath('data.backup.s3_storage.uuid', $storage->uuid);
});

it('does not re-enable s3 after an explicit disable', function () {
    seedInstanceDatabase();

    $storage = S3Storage::create([
        'name' => 'Backups bucket',
        'region' => 'us-east-1',
        'key' => 'test-key',
        'secret' => 'test-secret',
        'bucket' => 'test-bucket',
        'endpoint' => 'https://s3.example.com',
        'is_usable' => true,
        'team_id' => 0,
    ]);

    ScheduledDatabaseBackup::find(0)->update([
        'save_s3' => false,
        's3_storage_id' => $storage->id,
    ]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson('/api/devforge/v1/settings/backup')
        ->assertSuccessful()
        ->assertJsonPath('data.backup.save_s3', false)
        ->assertJsonPath('data.backup.s3_storage.uuid', $storage->uuid);
});
