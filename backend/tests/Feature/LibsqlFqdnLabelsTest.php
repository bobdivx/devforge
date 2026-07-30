<?php

use App\Models\Environment;
use App\Models\Project;
use App\Models\Server;
use App\Models\StandaloneDocker;
use App\Models\StandaloneLibsql;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

beforeEach(function () {
    $this->user = User::factory()->create();
    $this->team = $this->user->teams()->firstOrFail();
    $this->server = Server::factory()->create([
        'team_id' => $this->team->id,
    ]);
    $this->destination = $this->server->standaloneDockers()->firstOrFail();
    $this->project = Project::factory()->create(['team_id' => $this->team->id]);
    $this->environment = Environment::factory()->create(['project_id' => $this->project->id]);

    $this->database = StandaloneLibsql::withoutEvents(fn () => StandaloneLibsql::create([
        'uuid' => 'btnfrll4ubmua4nvk73y4h6u',
        'name' => 'Labels db',
        'libsql_auth_user' => 'libsql',
        'libsql_auth_token' => 'token',
        'status' => 'running:healthy',
        'is_public' => true,
        'fqdn' => 'https://db-btnfrll4ubmua4nvk73y4h6u.apps.example.com',
        'environment_id' => $this->environment->id,
        'destination_id' => $this->destination->id,
        'destination_type' => StandaloneDocker::class,
    ]));
    $this->database->load(['destination.server.settings', 'environment.project']);
});

it('builds proxy labels for public libsql domains on port 8080 without gzip', function () {
    $labels = libsqlFqdnLabels($this->database);

    expect($labels->contains('traefik.enable=true'))->toBeTrue();
    expect($labels->contains(fn (string $label) => str_contains($label, 'loadbalancer.server.port=8080')))->toBeTrue();
    expect($labels->contains(fn (string $label) => str_contains($label, 'Host(`db-btnfrll4ubmua4nvk73y4h6u.apps.example.com`)')))->toBeTrue();
    expect($labels->contains('traefik.http.middlewares.gzip.compress=true'))->toBeFalse();
});

it('skips proxy labels when libsql is not public', function () {
    $this->database->is_public = false;

    expect(libsqlFqdnLabels($this->database))->toBeEmpty();
});
