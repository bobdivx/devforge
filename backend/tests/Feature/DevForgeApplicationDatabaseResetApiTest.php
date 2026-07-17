<?php

use App\Models\Application;
use App\Models\Environment;
use App\Models\EnvironmentVariable;
use App\Models\Project;
use App\Models\Server;
use App\Models\StandaloneDocker;
use App\Models\StandaloneLibsql;
use App\Models\User;
use App\Services\DevForge\Database\LibsqlConnectionEnvSync;
use App\Services\DevForge\Database\LibsqlDatabaseTransferService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Queue;

uses(RefreshDatabase::class);

beforeEach(function () {
    config()->set('devforge.enabled', true);

    $this->user = User::factory()->create();
    $this->team = $this->user->teams()->firstOrFail();
    $this->session = ['currentTeam' => $this->team];

    $server = Server::factory()->create(['team_id' => $this->team->id]);
    $destination = $server->standaloneDockers()->firstOrFail();
    $project = Project::factory()->create(['team_id' => $this->team->id]);
    $environment = Environment::factory()->create(['project_id' => $project->id]);

    $this->application = Application::factory()->create([
        'environment_id' => $environment->id,
        'destination_id' => $destination->id,
        'destination_type' => StandaloneDocker::class,
    ]);

    $this->database = StandaloneLibsql::create([
        'name' => 'app-libsql',
        'uuid' => 'libsqltestdb01abcdefghijklmn',
        'environment_id' => $environment->id,
        'destination_id' => $destination->id,
        'destination_type' => StandaloneDocker::class,
    ]);

    EnvironmentVariable::create([
        'key' => 'TURSO_DATABASE_URL',
        'value' => 'libsql://example',
        'is_preview' => false,
        'is_runtime' => true,
        'is_buildtime' => true,
        'comment' => LibsqlConnectionEnvSync::LINK_COMMENT_PREFIX.$this->database->uuid,
        'resourceable_type' => $this->application->getMorphClass(),
        'resourceable_id' => $this->application->id,
    ]);
});

it('resets a linked libsql database from the application danger zone', function () {
    Queue::fake();

    $this->mock(LibsqlDatabaseTransferService::class, function ($mock): void {
        $mock->shouldReceive('resetEmpty')
            ->once()
            ->andReturn([
                'reset' => true,
                'restarted' => true,
                'message' => 'Base vidée et redémarrée.',
            ]);
    });

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson("/api/devforge/v1/applications/{$this->application->uuid}/databases/{$this->database->uuid}/reset", [
            'redeploy' => true,
        ])
        ->assertSuccessful()
        ->assertJsonPath('data.reset', true)
        ->assertJsonPath('data.database_uuid', $this->database->uuid)
        ->assertJsonPath('data.redeploy.queued', true);
});
