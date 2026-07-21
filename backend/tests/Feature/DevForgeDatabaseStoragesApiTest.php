<?php

use App\Jobs\ServerStorageSaveJob;
use App\Models\Environment;
use App\Models\LocalPersistentVolume;
use App\Models\Project;
use App\Models\Server;
use App\Models\StandaloneDocker;
use App\Models\StandalonePostgresql;
use App\Models\Team;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Bus;

uses(RefreshDatabase::class);

beforeEach(function () {
    config()->set('devforge.enabled', true);
    Bus::fake([ServerStorageSaveJob::class]);

    $this->user = User::factory()->create();
    $this->team = $this->user->teams()->firstOrFail();
    $this->session = ['currentTeam' => $this->team];

    $this->server = Server::factory()->create([
        'team_id' => $this->team->id,
    ]);
    $this->destination = $this->server->standaloneDockers()->firstOrFail();
    $this->project = Project::factory()->create(['team_id' => $this->team->id]);
    $this->environment = Environment::factory()->create(['project_id' => $this->project->id]);
    $this->database = StandalonePostgresql::factory()->create([
        'name' => 'Storages db',
        'environment_id' => $this->environment->id,
        'destination_id' => $this->destination->id,
        'destination_type' => StandaloneDocker::class,
    ]);
});

it('lists database storages metadata', function () {
    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson("/api/devforge/v1/databases/{$this->database->uuid}/storages")
        ->assertSuccessful()
        ->assertJsonPath('data.compose_managed', false)
        ->assertJsonPath('data.storages', []);
});

it('creates updates and deletes a database persistent volume', function () {
    $createResponse = $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson("/api/devforge/v1/databases/{$this->database->uuid}/storages", [
            'type' => 'persistent',
            'name' => 'pgdata',
            'mount_path' => '/var/lib/postgresql/data',
        ]);

    $createResponse
        ->assertCreated()
        ->assertJsonPath('data.type', 'persistent')
        ->assertJsonPath('data.mount_path', '/var/lib/postgresql/data')
        ->assertJsonPath('data.read_only', false);

    expect($createResponse->json('data.name'))->toBe($this->database->uuid.'-pgdata');

    $storageUuid = $createResponse->json('data.uuid');

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->putJson("/api/devforge/v1/databases/{$this->database->uuid}/storages/{$storageUuid}", [
            'mount_path' => '/data',
            'is_preview_suffix_enabled' => true,
        ])
        ->assertSuccessful()
        ->assertJsonPath('data.mount_path', '/data')
        ->assertJsonPath('data.is_preview_suffix_enabled', true);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->deleteJson("/api/devforge/v1/databases/{$this->database->uuid}/storages/{$storageUuid}")
        ->assertSuccessful();

    expect(LocalPersistentVolume::query()->where('uuid', $storageUuid)->exists())->toBeFalse();
});

it('creates a database file mount', function () {
    $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson("/api/devforge/v1/databases/{$this->database->uuid}/storages", [
            'type' => 'file',
            'mount_path' => '/custom.conf',
            'content' => "listen = *\n",
        ])
        ->assertCreated()
        ->assertJsonPath('data.type', 'file')
        ->assertJsonPath('data.mount_path', '/custom.conf')
        ->assertJsonPath('data.has_content', true)
        ->assertJsonMissingPath('data.content');

    Bus::assertDispatched(ServerStorageSaveJob::class);
});

it('scopes database storages to the current team', function () {
    $otherTeam = Team::factory()->create();
    $otherServer = Server::factory()->create(['team_id' => $otherTeam->id]);
    $otherDestination = $otherServer->standaloneDockers()->firstOrFail();
    $otherProject = Project::factory()->create(['team_id' => $otherTeam->id]);
    $otherEnvironment = Environment::factory()->create(['project_id' => $otherProject->id]);
    $otherDatabase = StandalonePostgresql::factory()->create([
        'environment_id' => $otherEnvironment->id,
        'destination_id' => $otherDestination->id,
        'destination_type' => StandaloneDocker::class,
    ]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson("/api/devforge/v1/databases/{$otherDatabase->uuid}/storages")
        ->assertNotFound();
});
