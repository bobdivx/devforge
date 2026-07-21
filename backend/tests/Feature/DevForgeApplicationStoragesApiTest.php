<?php

use App\Jobs\ServerStorageSaveJob;
use App\Models\Application;
use App\Models\Environment;
use App\Models\LocalPersistentVolume;
use App\Models\Project;
use App\Models\Server;
use App\Models\StandaloneDocker;
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
    $this->application = Application::factory()->create([
        'name' => 'Storages app',
        'environment_id' => $this->environment->id,
        'destination_id' => $this->destination->id,
        'destination_type' => StandaloneDocker::class,
        'build_pack' => 'nixpacks',
    ]);
});

it('lists application storages metadata', function () {
    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson("/api/devforge/v1/applications/{$this->application->uuid}/storages")
        ->assertSuccessful()
        ->assertJsonPath('data.compose_managed', false)
        ->assertJsonPath('data.storages', []);
});

it('creates updates and deletes a persistent volume', function () {
    $createResponse = $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson("/api/devforge/v1/applications/{$this->application->uuid}/storages", [
            'type' => 'persistent',
            'name' => 'data',
            'mount_path' => '/app/data',
        ]);

    $createResponse
        ->assertCreated()
        ->assertJsonPath('data.type', 'persistent')
        ->assertJsonPath('data.mount_path', '/app/data')
        ->assertJsonPath('data.read_only', false);

    expect($createResponse->json('data.name'))->toBe($this->application->uuid.'-data');

    $storageUuid = $createResponse->json('data.uuid');

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->putJson("/api/devforge/v1/applications/{$this->application->uuid}/storages/{$storageUuid}", [
            'mount_path' => '/app/storage',
            'is_preview_suffix_enabled' => true,
        ])
        ->assertSuccessful()
        ->assertJsonPath('data.mount_path', '/app/storage')
        ->assertJsonPath('data.is_preview_suffix_enabled', true);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->deleteJson("/api/devforge/v1/applications/{$this->application->uuid}/storages/{$storageUuid}")
        ->assertSuccessful();

    expect(LocalPersistentVolume::query()->where('uuid', $storageUuid)->exists())->toBeFalse();
});

it('creates a file mount without exposing content in the list', function () {
    $createResponse = $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson("/api/devforge/v1/applications/{$this->application->uuid}/storages", [
            'type' => 'file',
            'mount_path' => '/app/.env',
            'content' => "FOO=bar\n",
        ]);

    $createResponse
        ->assertCreated()
        ->assertJsonPath('data.type', 'file')
        ->assertJsonPath('data.mount_path', '/app/.env')
        ->assertJsonPath('data.is_directory', false)
        ->assertJsonPath('data.has_content', true)
        ->assertJsonMissingPath('data.content');

    Bus::assertDispatched(ServerStorageSaveJob::class);
});

it('rejects storage creation for dockercompose applications', function () {
    $this->application->update(['build_pack' => 'dockercompose']);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson("/api/devforge/v1/applications/{$this->application->uuid}/storages", [
            'type' => 'persistent',
            'name' => 'data',
            'mount_path' => '/data',
        ])
        ->assertStatus(422);
});

it('scopes application storages to the current team', function () {
    $otherTeam = Team::factory()->create();
    $otherServer = Server::factory()->create(['team_id' => $otherTeam->id]);
    $otherDestination = $otherServer->standaloneDockers()->firstOrFail();
    $otherProject = Project::factory()->create(['team_id' => $otherTeam->id]);
    $otherEnvironment = Environment::factory()->create(['project_id' => $otherProject->id]);
    $otherApplication = Application::factory()->create([
        'environment_id' => $otherEnvironment->id,
        'destination_id' => $otherDestination->id,
        'destination_type' => StandaloneDocker::class,
    ]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson("/api/devforge/v1/applications/{$otherApplication->uuid}/storages")
        ->assertNotFound();
});
