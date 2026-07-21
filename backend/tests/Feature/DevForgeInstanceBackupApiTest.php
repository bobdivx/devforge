<?php

use App\Models\InstanceSettings;
use App\Models\ScheduledDatabaseBackup;
use App\Models\Server;
use App\Models\StandaloneDocker;
use App\Models\StandalonePostgresql;
use App\Models\Team;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;

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

it('can fetch instance backup configuration when none is set', function () {
    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson('/api/devforge/v1/settings/backup')
        ->assertSuccessful()
        ->assertJsonPath('data.database', null)
        ->assertJsonPath('data.backup', null)
        ->assertJsonPath('data.is_server_functional', false);
});

it('can update instance backup database details', function () {
    $database = StandalonePostgresql::create([
        'id' => 0,
        'name' => 'coolify-db',
        'description' => 'Coolify database',
        'postgres_user' => 'coolify',
        'postgres_password' => 'password',
        'postgres_db' => 'coolify',
        'status' => 'running',
        'destination_type' => StandaloneDocker::class,
        'destination_id' => 0,
        'environment_id' => 1,
    ]);

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

    expect($database->fresh()->name)->toBe('devforge-db-new');
});
