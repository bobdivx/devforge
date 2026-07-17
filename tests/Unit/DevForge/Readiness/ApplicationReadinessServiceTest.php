<?php

use App\Jobs\DevForge\ApplicationDomainProbeJob;
use App\Models\AiAgent;
use App\Models\AiAgentRun;
use App\Models\AiProviderConfig;
use App\Models\Application;
use App\Models\ApplicationReadiness;
use App\Models\ApplicationReadinessIntervention;
use App\Models\Environment;
use App\Models\Project;
use App\Models\Server;
use App\Models\StandaloneDocker;
use App\Models\User;
use App\Services\DevForge\Agent\DeploymentReadinessAgentDispatcher;
use App\Services\DevForge\Readiness\ApplicationReadinessService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Schema;

uses(RefreshDatabase::class);

beforeEach(function () {
    config()->set('devforge.readiness_enabled', true);
    config()->set('devforge.readiness_probe_delay_seconds', 90);
    config()->set('devforge.agents_enabled', true);
    config()->set('devforge.readiness_max_rounds', 5);

    $this->user = User::factory()->create();
    $this->team = $this->user->teams()->firstOrFail();
    $server = Server::factory()->create(['team_id' => $this->team->id]);
    $destination = $server->standaloneDockers()->firstOrFail();
    $project = Project::factory()->create(['team_id' => $this->team->id]);
    $environment = Environment::factory()->create(['project_id' => $project->id]);
    $this->application = Application::factory()->create([
        'environment_id' => $environment->id,
        'destination_id' => $destination->id,
        'destination_type' => StandaloneDocker::class,
        'fqdn' => 'https://ready.example.com',
        'ports_exposes' => '80',
        'health_check_enabled' => false,
    ]);
    $this->provider = AiProviderConfig::factory()->create(['team_id' => $this->team->id]);
});

it('schedules a delayed probe after deployment finished', function () {
    Queue::fake();

    app(ApplicationReadinessService::class)->onDeploymentFinished(
        $this->application,
        'deploy-uuid-1',
    );

    $readiness = ApplicationReadiness::query()
        ->where('application_id', $this->application->id)
        ->first();

    expect($readiness)->not->toBeNull()
        ->and($readiness->status)->toBe(ApplicationReadiness::STATUS_PROBING)
        ->and($readiness->last_deployment_uuid)->toBe('deploy-uuid-1')
        ->and($this->application->fresh()->health_check_enabled)->toBeTrue();

    Queue::assertPushed(ApplicationDomainProbeJob::class, function (ApplicationDomainProbeJob $job): bool {
        return $job->applicationUuid === $this->application->uuid;
    });
});

it('marks readiness healthy when probe succeeds', function () {
    Http::fake([
        'https://ready.example.com' => Http::response('ok', 200),
    ]);

    $service = app(ApplicationReadinessService::class);
    $service->ensureFor($this->application);

    $result = $service->runProbe($this->application);

    expect($result['ok'])->toBeTrue()
        ->and($result['readiness']->status)->toBe(ApplicationReadiness::STATUS_HEALTHY);
});

it('dispatches readiness agent when probe fails', function () {
    Queue::fake();
    Http::fake([
        'https://ready.example.com' => Http::response('fail', 502),
    ]);

    AiAgent::factory()->deployment()->create([
        'team_id' => $this->team->id,
        'provider_config_id' => $this->provider->id,
        'resource_uuid' => $this->application->uuid,
    ]);

    $service = app(ApplicationReadinessService::class);
    $service->ensureFor($this->application);
    $result = $service->runProbe($this->application);

    expect($result['ok'])->toBeFalse()
        ->and($result['readiness']->status)->toBe(ApplicationReadiness::STATUS_RECOVERING)
        ->and($result['readiness']->round)->toBe(1);

    Queue::assertPushed(\App\Jobs\Agent\RunAgentJob::class, function ($job): bool {
        return ($job->context['event'] ?? null) === DeploymentReadinessAgentDispatcher::EVENT;
    });
});

it('creates an intervention on needs_user agent outcome', function () {
    $service = app(ApplicationReadinessService::class);
    $readiness = $service->ensureFor($this->application);
    $readiness->update([
        'status' => ApplicationReadiness::STATUS_RECOVERING,
        'last_deployment_uuid' => 'deploy-uuid-2',
        'last_probe_error' => 'Bad Gateway',
        'last_http_status' => 502,
        'round' => 1,
    ]);

    $agent = AiAgent::factory()->deployment()->create([
        'team_id' => $this->team->id,
        'provider_config_id' => $this->provider->id,
        'resource_uuid' => $this->application->uuid,
    ]);

    $run = AiAgentRun::create([
        'agent_id' => $agent->id,
        'status' => 'completed',
        'trigger' => 'event',
        'summary' => json_encode([
            'outcome' => 'needs_user',
            'title' => 'Configurer Turso',
            'summary' => 'ASTRO_DB manquant',
            'steps' => ['Ajouter ASTRO_DB_REMOTE_URL', 'Cliquer C’est fait'],
        ], JSON_UNESCAPED_UNICODE),
        'metadata' => [
            'event' => DeploymentReadinessAgentDispatcher::EVENT,
            'application_uuid' => $this->application->uuid,
            'readiness_round' => 1,
        ],
    ]);

    $service->handleAgentOutcome($run);

    $readiness->refresh();
    $intervention = ApplicationReadinessIntervention::query()
        ->where('application_id', $this->application->id)
        ->first();

    expect($readiness->status)->toBe(ApplicationReadiness::STATUS_AWAITING_USER)
        ->and($intervention)->not->toBeNull()
        ->and($intervention->title)->toBe('Configurer Turso')
        ->and($intervention->summary)->toContain('Erreur détectée : HTTP 502')
        ->and($intervention->summary)->toContain('ASTRO_DB manquant')
        ->and($intervention->steps)->toHaveCount(2);
});

it('replaces a generic intervention title with the probe error context', function () {
    $service = app(ApplicationReadinessService::class);
    $readiness = $service->ensureFor($this->application);
    $readiness->update([
        'status' => ApplicationReadiness::STATUS_RECOVERING,
        'last_probe_error' => 'Connection refused',
        'last_http_status' => 503,
        'round' => 1,
    ]);

    $agent = AiAgent::factory()->deployment()->create([
        'team_id' => $this->team->id,
        'provider_config_id' => $this->provider->id,
        'resource_uuid' => $this->application->uuid,
    ]);

    $run = AiAgentRun::create([
        'agent_id' => $agent->id,
        'status' => 'completed',
        'trigger' => 'event',
        'summary' => 'Le domaine reste inaccessible après redémarrage.',
        'metadata' => [
            'event' => DeploymentReadinessAgentDispatcher::EVENT,
            'application_uuid' => $this->application->uuid,
            'readiness_round' => 1,
        ],
    ]);

    $service->handleAgentOutcome($run);

    $intervention = ApplicationReadinessIntervention::query()
        ->where('application_id', $this->application->id)
        ->first();

    expect($intervention)->not->toBeNull()
        ->and($intervention->title)->toBe('Corriger l’erreur HTTP 503')
        ->and($intervention->summary)->toContain('Erreur détectée : HTTP 503 — Connection refused')
        ->and($intervention->steps)->not->toBeEmpty();
});

it('acknowledges intervention done and schedules re-probe', function () {
    Queue::fake();

    $this->mock(\App\Services\DevForge\Core\CoreResourceAction::class, function ($mock): void {
        $mock->shouldReceive('execute')
            ->once()
            ->andReturn([
                'resource_uuid' => $this->application->uuid,
                'resource_type' => 'application',
                'action' => 'restart',
                'queued' => true,
                'deployment_uuid' => 'restart-uuid',
                'message' => 'Application restart request queued.',
            ]);
    });

    $service = app(ApplicationReadinessService::class);
    $readiness = $service->ensureFor($this->application);
    $intervention = ApplicationReadinessIntervention::query()->create([
        'application_id' => $this->application->id,
        'title' => 'Fix env',
        'summary' => 'Ajoute les variables',
        'steps' => [
            ['rank' => 1, 'text' => 'Ajouter TOKEN', 'done' => false],
        ],
        'status' => ApplicationReadinessIntervention::STATUS_OPEN,
    ]);
    $readiness->update([
        'status' => ApplicationReadiness::STATUS_AWAITING_USER,
        'active_intervention_id' => $intervention->id,
    ]);

    $result = $service->acknowledgeInterventionDone($this->application, $intervention->uuid);

    $intervention->refresh();
    $readiness->refresh();

    expect($intervention->status)->toBe(ApplicationReadinessIntervention::STATUS_ACKNOWLEDGED)
        ->and($intervention->steps[0]['done'])->toBeTrue()
        ->and($readiness->status)->toBe(ApplicationReadiness::STATUS_RECOVERING)
        ->and($result['readiness']['status'])->toBe(ApplicationReadiness::STATUS_RECOVERING);

    Queue::assertPushed(ApplicationDomainProbeJob::class);
});

it('presents readiness and creates the row lazily', function () {
    $service = app(ApplicationReadinessService::class);

    expect(ApplicationReadiness::query()->where('application_id', $this->application->id)->exists())->toBeFalse();

    $payload = $service->present($this->application);

    expect($payload['status'])->toBe(ApplicationReadiness::STATUS_IDLE)
        ->and($payload['uuid'])->not->toBeNull()
        ->and($payload['probe_url'])->toBe('https://ready.example.com')
        ->and(ApplicationReadiness::query()->where('application_id', $this->application->id)->exists())->toBeTrue();
});

it('returns a degraded present payload when readiness tables are missing', function () {
    Schema::dropIfExists('application_readiness_interventions');
    Schema::dropIfExists('application_readiness');

    $payload = app(ApplicationReadinessService::class)->present($this->application);

    expect($payload['degraded'])->toBeTrue()
        ->and($payload['status'])->toBe(ApplicationReadiness::STATUS_IDLE)
        ->and($payload['uuid'])->toBeNull()
        ->and($payload['last_probe_error'])->not->toBeNull();
});
