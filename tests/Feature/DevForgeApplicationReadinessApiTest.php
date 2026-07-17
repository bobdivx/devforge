<?php

use App\Models\Application;
use App\Models\ApplicationReadiness;
use App\Models\ApplicationReadinessIntervention;
use App\Models\Environment;
use App\Models\Project;
use App\Models\Server;
use App\Models\StandaloneDocker;
use App\Models\User;
use App\Services\DevForge\Core\CoreResourceAction;
use App\Services\DevForge\Readiness\ApplicationReadinessService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;

uses(RefreshDatabase::class);

beforeEach(function () {
    config()->set('devforge.enabled', true);
    config()->set('devforge.readiness_enabled', true);

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
        'fqdn' => 'https://ready-api.example.com',
    ]);

    app(ApplicationReadinessService::class)->ensureFor($this->application, true);
});

it('returns readiness payload for an application', function () {
    $this->actingAs($this->user)
        ->withSession($this->session)
        ->getJson("/api/devforge/v1/applications/{$this->application->uuid}/readiness")
        ->assertSuccessful()
        ->assertJsonPath('data.autonomous_enabled', true)
        ->assertJsonPath('data.status', ApplicationReadiness::STATUS_IDLE)
        ->assertJsonPath('data.probe_url', 'https://ready-api.example.com');
});

it('updates autonomous_enabled via patch', function () {
    $this->actingAs($this->user)
        ->withSession($this->session)
        ->patchJson("/api/devforge/v1/applications/{$this->application->uuid}/readiness", [
            'autonomous_enabled' => false,
        ])
        ->assertSuccessful()
        ->assertJsonPath('data.autonomous_enabled', false);
});

it('runs a manual probe', function () {
    Http::fake([
        'https://ready-api.example.com' => Http::response('ok', 200),
    ]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson("/api/devforge/v1/applications/{$this->application->uuid}/readiness/probe")
        ->assertSuccessful()
        ->assertJsonPath('data.status', ApplicationReadiness::STATUS_HEALTHY)
        ->assertJsonPath('meta.probe_ok', true);
});

it('acknowledges an intervention as done', function () {
    Queue::fake();

    $this->mock(CoreResourceAction::class, function ($mock): void {
        $mock->shouldReceive('execute')->once()->andReturn([
            'resource_uuid' => $this->application->uuid,
            'resource_type' => 'application',
            'action' => 'restart',
            'queued' => true,
            'message' => 'ok',
        ]);
    });

    $readiness = ApplicationReadiness::query()
        ->where('application_id', $this->application->id)
        ->firstOrFail();

    $intervention = ApplicationReadinessIntervention::query()->create([
        'application_id' => $this->application->id,
        'title' => 'Fix domain',
        'summary' => 'Corrige le DNS',
        'steps' => [['rank' => 1, 'text' => 'Mettre à jour DNS', 'done' => false]],
        'status' => ApplicationReadinessIntervention::STATUS_OPEN,
    ]);

    $readiness->update([
        'status' => ApplicationReadiness::STATUS_AWAITING_USER,
        'active_intervention_id' => $intervention->id,
    ]);

    $this->actingAs($this->user)
        ->withSession($this->session)
        ->postJson("/api/devforge/v1/applications/{$this->application->uuid}/readiness/interventions/{$intervention->uuid}/done")
        ->assertSuccessful()
        ->assertJsonPath('data.status', ApplicationReadiness::STATUS_RECOVERING);

    expect($intervention->fresh()->status)->toBe(ApplicationReadinessIntervention::STATUS_ACKNOWLEDGED);
});
