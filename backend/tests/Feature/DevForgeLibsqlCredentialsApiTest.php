<?php

use App\Actions\Database\StartDatabase;
use App\Models\Application;
use App\Models\Environment;
use App\Models\EnvironmentVariable;
use App\Models\Project;
use App\Models\Server;
use App\Models\StandaloneDocker;
use App\Models\StandaloneLibsql;
use App\Models\Team;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Bus;

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
        'uuid' => fake()->uuid(),
        'name' => 'Credentials db',
        'libsql_auth_user' => 'libsql',
        'libsql_auth_token' => 'initial-token',
        'status' => 'running:healthy',
        'environment_id' => $this->environment->id,
        'destination_id' => $this->destination->id,
        'destination_type' => StandaloneDocker::class,
    ]));

    $this->application = Application::factory()->create([
        'name' => 'Linked app',
        'environment_id' => $this->environment->id,
        'destination_id' => $this->destination->id,
        'destination_type' => StandaloneDocker::class,
        'git_repository' => 'acme/demo-app',
        'git_branch' => 'main',
    ]);
});

it('returns libsql credentials for authorized users', function () {
    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson("/api/devforge/v1/databases/{$this->database->uuid}/credentials")
        ->assertSuccessful()
        ->assertJsonPath('data.turso_database_url', "libsql://{$this->database->uuid}:8080")
        ->assertJsonPath('data.turso_auth_token', 'initial-token')
        ->assertJsonPath('data.is_public', false);
});

it('regenerates libsql auth token and syncs linked applications', function () {
    $this->application->environment_variables()->create([
        'key' => 'TURSO_DATABASE_URL',
        'value' => "libsql://{$this->database->uuid}:8080",
        'comment' => 'devforge:database:'.$this->database->uuid,
        'is_preview' => false,
        'is_runtime' => true,
        'is_buildtime' => true,
    ]);
    $this->application->environment_variables()->create([
        'key' => 'TURSO_AUTH_TOKEN',
        'value' => 'initial-token',
        'comment' => 'devforge:database:'.$this->database->uuid,
        'is_preview' => false,
        'is_runtime' => true,
        'is_buildtime' => true,
    ]);

    $response = $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson("/api/devforge/v1/databases/{$this->database->uuid}/regenerate-token", [
            'redeploy_applications' => false,
        ])
        ->assertSuccessful();

    $newToken = $response->json('data.turso_auth_token');
    expect($newToken)->not->toBe('initial-token');

    $this->database->refresh();
    expect($this->database->libsql_auth_token)->toBe($newToken);

    expect(EnvironmentVariable::query()
        ->where('resourceable_id', $this->application->id)
        ->where('key', 'TURSO_AUTH_TOKEN')
        ->first()?->real_value)
        ->toBe($newToken);
});

it('enables public access for libsql databases', function () {
    Bus::fake([StartDatabase::class]);

    $response = $this->actingAs($this->user)
        ->withSession($this->session)
        ->putJson("/api/devforge/v1/databases/{$this->database->uuid}/public-access", [
            'enabled' => true,
            'public_port' => 19080,
            'redeploy_applications' => false,
        ])
        ->assertSuccessful()
        ->assertJsonPath('data.is_public', true)
        ->assertJsonPath('data.public_port', 19080);

    expect($response->json('data.turso_database_url_external'))->toEndWith(':19080');

    $this->database->refresh();
    expect($this->database->is_public)->toBeTrue()
        ->and($this->database->public_port)->toBe(19080);

    Bus::assertDispatched(StartDatabase::class);
});
