<?php

use App\Models\AiAgent;
use App\Models\Application;
use App\Models\Environment;
use App\Models\Project;
use App\Models\Server;
use App\Models\Service;
use App\Models\StandaloneDocker;
use App\Models\StandalonePostgresql;
use App\Models\Team;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

beforeEach(function () {
    config()->set('devforge.enabled', true);
    config()->set('devforge.agents_enabled', true);

    $this->user = User::factory()->create();
    $this->team = $this->user->teams()->firstOrFail();
    $this->session = ['currentTeam' => $this->team];

    $this->server = Server::factory()->create(['team_id' => $this->team->id]);
    $this->destination = $this->server->standaloneDockers()->firstOrFail();
    $this->project = Project::factory()->create(['team_id' => $this->team->id]);
    $this->environment = Environment::factory()->create(['project_id' => $this->project->id]);
    $this->application = Application::factory()->create([
        'environment_id' => $this->environment->id,
        'destination_id' => $this->destination->id,
        'destination_type' => StandaloneDocker::class,
        'status' => 'running',
    ]);
    Service::factory()->create([
        'environment_id' => $this->environment->id,
        'destination_id' => $this->destination->id,
        'destination_type' => StandaloneDocker::class,
    ]);
    StandalonePostgresql::withoutEvents(fn () => StandalonePostgresql::create([
        'uuid' => fake()->uuid(),
        'name' => 'Overview database',
        'image' => 'postgres:17',
        'postgres_user' => 'postgres',
        'postgres_password' => 'secret',
        'postgres_db' => 'app',
        'environment_id' => $this->environment->id,
        'destination_id' => $this->destination->id,
        'destination_type' => StandaloneDocker::class,
        'status' => 'running',
    ]));
});

it('returns enriched overview data scoped to the current team', function () {
    AiAgent::factory()->create(['team_id' => $this->team->id, 'is_active' => true]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson('/api/devforge/v1/overview')
        ->assertSuccessful()
        ->assertJsonStructure([
            'data' => [
                'counts' => ['projects', 'environments', 'shared_variables', 'private_keys', 'members'],
                'recent_projects',
                'health' => ['score', 'total_resources', 'running', 'degraded', 'stopped'],
                'resource_statuses' => ['applications', 'services', 'databases', 'servers'],
                'recent_deployments',
                'agent_activity',
                'agents_summary' => ['total', 'active', 'running'],
            ],
        ])
        ->assertJsonPath('data.counts.projects', 1)
        ->assertJsonPath('data.agents_summary.total', 1);
});

it('returns overview when the session team was not initialized yet', function () {
    $this->actingAs($this->user)
        ->getJson('/api/devforge/v1/overview')
        ->assertSuccessful()
        ->assertJsonPath('data.counts.projects', 1);

    expect(session('currentTeam')->id)->toBe($this->team->id);
});

it('invalidates overview data after switching teams', function () {
    $otherUser = User::factory()->create();
    $otherTeam = $otherUser->teams()->firstOrFail();
    Project::factory()->create(['team_id' => $otherTeam->id, 'name' => 'Other team project']);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson('/api/devforge/v1/overview')
        ->assertJsonPath('data.counts.projects', 1);

    $this->actingAs($otherUser)
        ->withSession(['currentTeam' => $otherTeam])
        ->getJson('/api/devforge/v1/overview')
        ->assertJsonPath('data.counts.projects', 1)
        ->assertJsonMissing(['name' => $this->project->name]);
});

it('returns forbidden when current team is outside user memberships', function () {
    $foreignTeam = Team::factory()->create();

    $this->actingAs($this->user)
        ->withSession(['currentTeam' => $foreignTeam])
        ->getJson('/api/devforge/v1/overview')
        ->assertForbidden()
        ->assertJsonPath('message', 'The selected team is not available.');
});
