<?php

use App\Models\Environment;
use App\Models\Project;
use App\Models\Server;
use App\Models\StandaloneDocker;
use App\Models\StandaloneLibsql;
use App\Models\StandalonePostgresql;
use App\Models\User;
use App\Services\DevForge\Database\LibsqlDatabaseTransferService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;

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
        'uuid' => 'w5gu3c9d5ezohux0wv63s5m4',
        'name' => 'libsql-database-test',
        'libsql_auth_user' => 'libsql',
        'libsql_auth_token' => 'secret-token',
        'environment_id' => $this->environment->id,
        'destination_id' => $this->destination->id,
        'destination_type' => StandaloneDocker::class,
    ]));
});

it('exports libsql database sql', function () {
    $this->mock(LibsqlDatabaseTransferService::class, function ($mock): void {
        $mock->shouldReceive('export')->once()->andReturn("PRAGMA foreign_keys=OFF;\nCREATE TABLE users (id INTEGER);\n");
    });

    $response = $this->actingAs($this->user)
        ->withSession($this->session)
        ->get('/api/devforge/v1/databases/'.$this->database->uuid.'/export-sql');

    $response->assertSuccessful();
    expect($response->headers->get('content-disposition'))->toContain('libsql-database-test');
    expect($response->getContent())->toContain('CREATE TABLE users');
});

it('imports libsql database sql from an uploaded file', function () {
    $this->mock(LibsqlDatabaseTransferService::class, function ($mock): void {
        $mock->shouldReceive('import')
            ->once()
            ->withArgs(fn ($database, string $sql): bool => $database->uuid === 'w5gu3c9d5ezohux0wv63s5m4'
                && str_contains($sql, 'CREATE TABLE users'))
            ->andReturn([
                'restarted' => true,
                'message' => 'Import terminé. La base redémarre.',
            ]);
    });

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->post('/api/devforge/v1/databases/'.$this->database->uuid.'/import-sql', [
            'file' => UploadedFile::fake()->createWithContent('dump.sql', "PRAGMA foreign_keys=OFF;\nCREATE TABLE users (id INTEGER);\n"),
        ])
        ->assertSuccessful()
        ->assertJsonPath('data.restarted', true);
});

it('rejects sql transfer endpoints for non libsql databases', function () {
    $postgresql = StandalonePostgresql::withoutEvents(fn () => StandalonePostgresql::create([
        'uuid' => fake()->uuid(),
        'name' => 'pg-db',
        'image' => 'postgres:17',
        'postgres_user' => 'postgres',
        'postgres_password' => 'secret-password',
        'postgres_db' => 'app',
        'environment_id' => $this->environment->id,
        'destination_id' => $this->destination->id,
        'destination_type' => StandaloneDocker::class,
    ]));

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson('/api/devforge/v1/databases/'.$postgresql->uuid.'/export-sql')
        ->assertStatus(422);
});
