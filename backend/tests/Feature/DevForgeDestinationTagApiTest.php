<?php

use App\Models\Application;
use App\Models\Environment;
use App\Models\Project;
use App\Models\Server;
use App\Models\Service;
use App\Models\StandaloneDocker;
use App\Models\Tag;
use App\Models\Team;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

beforeEach(function () {
    config()->set('devforge.enabled', true);

    $this->user = User::factory()->create();
    $this->team = $this->user->teams()->firstOrFail();
    $this->server = Server::factory()->create([
        'team_id' => $this->team->id,
        'ip' => '10.0.0.20',
    ]);
    $this->destination = $this->server->standaloneDockers()->firstOrFail();
    $this->project = Project::factory()->create(['team_id' => $this->team->id]);
    $this->environment = Environment::factory()->create(['project_id' => $this->project->id]);
    $this->application = Application::factory()->create([
        'environment_id' => $this->environment->id,
        'destination_id' => $this->destination->id,
        'destination_type' => StandaloneDocker::class,
    ]);
    $this->service = Service::factory()->create([
        'environment_id' => $this->environment->id,
        'destination_id' => $this->destination->id,
        'destination_type' => StandaloneDocker::class,
    ]);
});

it('lists destinations for the current team', function () {
    $otherTeam = Team::factory()->create();
    $otherServer = Server::factory()->create(['team_id' => $otherTeam->id]);

    $this->actingAs($this->user)
        ->withSession(['currentTeam' => $this->team])
        ->getJson('/api/devforge/v1/destinations')
        ->assertSuccessful()
        ->assertJsonFragment([
            'uuid' => $this->destination->uuid,
            'name' => $this->destination->name,
            'type' => 'standalone',
        ])
        ->assertJsonMissing([
            'uuid' => $otherServer->standaloneDockers()->firstOrFail()->uuid,
        ]);
});

it('shows a destination and its resources for the current team', function () {
    $this->actingAs($this->user)
        ->withSession(['currentTeam' => $this->team])
        ->getJson("/api/devforge/v1/destinations/{$this->destination->uuid}")
        ->assertSuccessful()
        ->assertJsonPath('data.server.ip', '10.0.0.20')
        ->assertJsonPath('data.supports_resources_page', true);

    $this->actingAs($this->user)
        ->withSession(['currentTeam' => $this->team])
        ->getJson("/api/devforge/v1/destinations/{$this->destination->uuid}/resources")
        ->assertSuccessful()
        ->assertJsonFragment([
            'uuid' => $this->application->uuid,
            'type' => 'application',
            'name' => $this->application->name,
        ])
        ->assertJsonFragment([
            'uuid' => $this->service->uuid,
            'type' => 'service',
        ]);
});

it('lists and shows tags for the current team', function () {
    $tag = Tag::create([
        'name' => 'production',
        'team_id' => $this->team->id,
    ]);
    $this->application->tags()->attach($tag);
    $this->service->tags()->attach($tag);

    $this->actingAs($this->user)
        ->withSession(['currentTeam' => $this->team])
        ->getJson('/api/devforge/v1/tags')
        ->assertSuccessful()
        ->assertJsonFragment([
            'name' => 'production',
            'applications_count' => 1,
            'services_count' => 1,
        ]);

    $response = $this->actingAs($this->user)
        ->withSession(['currentTeam' => $this->team])
        ->getJson('/api/devforge/v1/tags/production')
        ->assertSuccessful()
        ->assertJsonPath('data.applications_count', 1)
        ->assertJsonPath('data.services_count', 1)
        ->assertJsonPath('data.applications.0.uuid', $this->application->uuid);

    expect($response->json('data.webhook_url'))->toContain('/api/v1/deploy?tag=production');
});

it('creates updates and deletes destinations for the current team', function () {
    $this->server->settings->update(['is_swarm_manager' => true]);

    $create = $this->actingAs($this->user)
        ->withSession(['currentTeam' => $this->team])
        ->postJson('/api/devforge/v1/destinations', [
            'server_uuid' => $this->server->uuid,
            'network' => 'custom-overlay',
            'name' => 'staging-overlay',
            'type' => 'swarm',
        ])
        ->assertCreated()
        ->assertJsonPath('data.name', 'staging-overlay')
        ->assertJsonPath('data.network', 'custom-overlay')
        ->assertJsonPath('data.type', 'swarm');

    $destinationUuid = $create->json('data.uuid');

    $this->actingAs($this->user)
        ->withSession(['currentTeam' => $this->team])
        ->putJson("/api/devforge/v1/destinations/{$destinationUuid}", [
            'name' => 'staging-overlay-updated',
        ])
        ->assertSuccessful()
        ->assertJsonPath('data.name', 'staging-overlay-updated');

    $this->actingAs($this->user)
        ->withSession(['currentTeam' => $this->team])
        ->deleteJson("/api/devforge/v1/destinations/{$destinationUuid}")
        ->assertNoContent();
});

it('rejects destination deletion when resources are still attached', function () {
    $this->actingAs($this->user)
        ->withSession(['currentTeam' => $this->team])
        ->deleteJson("/api/devforge/v1/destinations/{$this->destination->uuid}")
        ->assertStatus(409)
        ->assertJsonValidationErrors(['destination']);
});

it('returns not found for destinations and tags outside the current team', function () {
    $otherTeam = Team::factory()->create();
    $otherServer = Server::factory()->create(['team_id' => $otherTeam->id]);
    $otherDestination = $otherServer->standaloneDockers()->firstOrFail();

    $this->actingAs($this->user)
        ->withSession(['currentTeam' => $this->team])
        ->getJson("/api/devforge/v1/destinations/{$otherDestination->uuid}")
        ->assertNotFound();

    Tag::create([
        'name' => 'staging',
        'team_id' => $otherTeam->id,
    ]);

    $this->actingAs($this->user)
        ->withSession(['currentTeam' => $this->team])
        ->getJson('/api/devforge/v1/tags/staging')
        ->assertNotFound();
});

it('creates and deletes tags for the current team', function () {
    $this->actingAs($this->user)
        ->withSession(['currentTeam' => $this->team])
        ->postJson('/api/devforge/v1/tags', [
            'name' => 'Staging',
        ])
        ->assertCreated()
        ->assertJsonPath('data.name', 'staging')
        ->assertJsonPath('data.applications_count', 0)
        ->assertJsonPath('data.services_count', 0);

    $this->actingAs($this->user)
        ->withSession(['currentTeam' => $this->team])
        ->deleteJson('/api/devforge/v1/tags/staging')
        ->assertNoContent();

    $this->actingAs($this->user)
        ->withSession(['currentTeam' => $this->team])
        ->getJson('/api/devforge/v1/tags/staging')
        ->assertNotFound();
});

it('rejects tag deletion when resources are still attached', function () {
    $tag = Tag::create([
        'name' => 'production',
        'team_id' => $this->team->id,
    ]);
    $this->application->tags()->attach($tag);

    $this->actingAs($this->user)
        ->withSession(['currentTeam' => $this->team])
        ->deleteJson('/api/devforge/v1/tags/production')
        ->assertStatus(409)
        ->assertJsonValidationErrors(['tag']);
});

it('redeploys all resources associated with a tag', function () {
    $tag = Tag::create([
        'name' => 'release',
        'team_id' => $this->team->id,
    ]);
    $this->application->tags()->attach($tag);
    $this->service->tags()->attach($tag);

    $this->actingAs($this->user)
        ->withSession(['currentTeam' => $this->team])
        ->postJson('/api/devforge/v1/tags/release/redeploy')
        ->assertAccepted()
        ->assertJsonPath('data.tag', 'release')
        ->assertJsonPath('data.applications_queued', 1)
        ->assertJsonPath('data.services_queued', 1)
        ->assertJsonCount(2, 'data.results');
});

it('rejects tag redeploy when no resources are attached', function () {
    Tag::create([
        'name' => 'empty-tag',
        'team_id' => $this->team->id,
    ]);

    $this->actingAs($this->user)
        ->withSession(['currentTeam' => $this->team])
        ->postJson('/api/devforge/v1/tags/empty-tag/redeploy')
        ->assertStatus(422)
        ->assertJsonValidationErrors(['tag']);
});
