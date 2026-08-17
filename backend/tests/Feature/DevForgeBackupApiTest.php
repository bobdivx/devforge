<?php



use App\Jobs\DatabaseBackupJob;
use App\Models\Environment;
use App\Models\Project;
use App\Models\S3Storage;
use App\Models\ScheduledDatabaseBackup;
use App\Models\Server;
use App\Models\StandalonePostgresql;
use App\Models\Team;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;



uses(RefreshDatabase::class);



function createDevForgePostgresqlDatabase(Team $team): StandalonePostgresql

{

    $server = Server::factory()->create(['team_id' => $team->id]);

    $destination = $server->standaloneDockers()->firstOrFail();

    $project = Project::factory()->create(['team_id' => $team->id]);

    $environment = Environment::factory()->create(['project_id' => $project->id]);



    return StandalonePostgresql::create([

        'name' => 'Backup DB',

        'image' => 'postgres:16-alpine',

        'postgres_user' => 'postgres',

        'postgres_password' => 'password',

        'postgres_db' => 'postgres',

        'environment_id' => $environment->id,

        'destination_id' => $destination->id,

        'destination_type' => $destination->getMorphClass(),

    ]);

}



function createDevForgeS3Storage(Team $team, string $name = 'DevForge S3'): S3Storage

{

    return S3Storage::create([

        'name' => $name,

        'region' => 'us-east-1',

        'key' => 'test-key',

        'secret' => 'test-secret',

        'bucket' => 'test-bucket',

        'endpoint' => 'https://s3.example.com',

        'is_usable' => true,

        'team_id' => $team->id,

    ]);

}



beforeEach(function () {

    config()->set('devforge.enabled', true);



    $this->user = User::factory()->create();

    $this->team = $this->user->teams()->firstOrFail();

    $this->session = ['currentTeam' => $this->team];

    $this->database = createDevForgePostgresqlDatabase($this->team);

});



it('lists s3 storages for the current team', function () {

    $storage = createDevForgeS3Storage($this->team);



    $this->actingAs($this->user)

        ->withSession($this->session)

        ->getJson('/api/devforge/v1/s3-storages')

        ->assertOk()

        ->assertJsonPath('data.0.uuid', $storage->uuid)

        ->assertJsonPath('data.0.name', 'DevForge S3');

});

it('shows a single s3 storage for the current team', function () {
    $storage = createDevForgeS3Storage($this->team);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson("/api/devforge/v1/s3-storages/{$storage->uuid}")
        ->assertOk()
        ->assertJsonPath('data.uuid', $storage->uuid)
        ->assertJsonPath('data.bucket', 'test-bucket');
});

it('creates an s3 storage for the current team', function () {

    $this->actingAs($this->user)

        ->withSession($this->session)

        ->postJson('/api/devforge/v1/s3-storages', [

            'name' => 'Backups EU',

            'description' => 'Bucket principal',

            'region' => 'eu-west-1',

            'key' => 'access-key',

            'secret' => 'secret-key',

            'bucket' => 'coolify-backups',

            'endpoint' => 'https://s3.eu-west-1.amazonaws.com',

        ])

        ->assertCreated()

        ->assertJsonPath('data.name', 'Backups EU')

        ->assertJsonPath('data.bucket', 'coolify-backups');



    expect(S3Storage::query()->where('team_id', $this->team->id)->count())->toBe(1);

});



it('lists database backups for a database', function () {

    $backup = ScheduledDatabaseBackup::create([

        'team_id' => $this->team->id,

        'database_id' => $this->database->id,

        'database_type' => $this->database->getMorphClass(),

        'frequency' => '0 0 * * *',

        'enabled' => true,

        'save_s3' => false,

    ]);



    $this->actingAs($this->user)

        ->withSession($this->session)

        ->getJson("/api/devforge/v1/databases/{$this->database->uuid}/backups")

        ->assertOk()

        ->assertJsonPath('meta.supports_backups', true)

        ->assertJsonPath('data.0.uuid', $backup->uuid)

        ->assertJsonPath('data.0.frequency', '0 0 * * *');

});



it('creates a database backup with s3 destination', function () {

    Queue::fake();



    $storage = createDevForgeS3Storage($this->team);



    $this->actingAs($this->user)

        ->withSession($this->session)

        ->postJson("/api/devforge/v1/databases/{$this->database->uuid}/backups", [

            'frequency' => '0 0 * * *',

            'save_s3' => true,

            's3_storage_uuid' => $storage->uuid,

            'backup_now' => true,

        ])

        ->assertCreated()

        ->assertJsonPath('data.save_s3', true)

        ->assertJsonPath('data.s3_storage.uuid', $storage->uuid);



    Queue::assertPushed(DatabaseBackupJob::class);

});



it('rejects s3 backup without a storage uuid', function () {

    $this->actingAs($this->user)

        ->withSession($this->session)

        ->postJson("/api/devforge/v1/databases/{$this->database->uuid}/backups", [

            'frequency' => '0 0 * * *',

            'save_s3' => true,

        ])

        ->assertUnprocessable()

        ->assertJsonValidationErrors(['s3_storage_uuid']);

});



it('queues a manual database backup run', function () {

    Queue::fake();



    $backup = ScheduledDatabaseBackup::create([

        'team_id' => $this->team->id,

        'database_id' => $this->database->id,

        'database_type' => $this->database->getMorphClass(),

        'frequency' => '0 0 * * *',

        'enabled' => true,

        'save_s3' => false,

    ]);



    $this->actingAs($this->user)

        ->withSession($this->session)

        ->postJson("/api/devforge/v1/databases/{$this->database->uuid}/backups/{$backup->uuid}/run")

        ->assertOk()

        ->assertJsonPath('data.queued', true);



    Queue::assertPushed(DatabaseBackupJob::class);

});

it('attaches the team s3 destination when creating a backup without save_s3', function () {
    config()->set('devforge.backup_s3.enabled', true);
    config()->set('devforge.backup_s3.attach_new_backups', true);

    $storage = createDevForgeS3Storage($this->team);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson("/api/devforge/v1/databases/{$this->database->uuid}/backups", [
            'frequency' => '0 0 * * *',
        ])
        ->assertCreated()
        ->assertJsonPath('data.save_s3', true)
        ->assertJsonPath('data.s3_storage.uuid', $storage->uuid);
});

it('tests an s3 storage connection with a cuid identifier', function () {
    $storage = createDevForgeS3Storage($this->team);
    $storage->uuid = 'my2gtulfu369jfgyygmz6gvu';
    $storage->save();

    $disk = Mockery::mock();
    $disk->expects('files')->once()->andReturn([]);
    Storage::expects('build')->once()->andReturn($disk);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson("/api/devforge/v1/s3-storages/{$storage->uuid}/test")
        ->assertOk()
        ->assertJsonPath('data.success', true)
        ->assertJsonPath('data.message', 'Connexion S3 validée.')
        ->assertJsonPath('data.storage.uuid', 'my2gtulfu369jfgyygmz6gvu');

    expect($storage->fresh()->is_usable)->toBeTrue();
});

it('returns not found when testing an s3 storage that does not exist', function () {
    $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson('/api/devforge/v1/s3-storages/my2gtulfu369jfgyygmz6gvu/test')
        ->assertNotFound();
});

it('normalizes a scaleway virtual-hosted endpoint on create', function () {
    $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson('/api/devforge/v1/s3-storages', [
            'name' => 'Scaleway',
            'region' => 'us-east-1',
            'key' => 'access-key',
            'secret' => 'secret-key',
            'bucket' => 'devforge',
            'endpoint' => 'https://devforge.s3.fr-par.scw.cloud',
        ])
        ->assertCreated()
        ->assertJsonPath('data.endpoint', 'https://s3.fr-par.scw.cloud')
        ->assertJsonPath('data.bucket', 'devforge')
        ->assertJsonPath('data.region', 'fr-par');
});

