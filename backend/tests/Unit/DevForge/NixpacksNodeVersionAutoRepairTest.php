<?php

use App\Models\Application;
use App\Models\ApplicationDeploymentQueue;
use App\Models\Environment;
use App\Models\Project;
use App\Models\Server;
use App\Models\StandaloneDocker;
use App\Models\User;
use App\Jobs\ApplicationDeploymentJob;
use App\Services\DevForge\Application\NixpacksNodeVersionApplier;
use App\Services\DevForge\Application\NixpacksNodeVersionAutoRepair;
use App\Services\DevForge\Application\NixpacksNodeVersionResolver;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\Cache;

uses(RefreshDatabase::class);

beforeEach(function () {
    config()->set('devforge.enabled', true);

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
        'build_pack' => 'nixpacks',
    ]);
});

it('updates production and preview NIXPACKS_NODE_VERSION', function () {
    $applier = app(NixpacksNodeVersionApplier::class);

    expect($applier->current($this->application))->toBe('22')
        ->and($applier->apply($this->application, '16'))->toBeTrue()
        ->and($applier->current($this->application->fresh()))->toBe('16');

    $preview = $this->application->environment_variables_preview()
        ->where('key', 'NIXPACKS_NODE_VERSION')
        ->first();

    expect($preview?->value)->toBe('16')
        ->and($preview?->comment)->toBe(NixpacksNodeVersionResolver::AUTO_COMMENT);
});

it('extracts yarn engine errors from deployment log json', function () {
    $repair = app(NixpacksNodeVersionAutoRepair::class);
    $logs = json_encode([
        ['output' => 'error @apollo/federation@0.27.0: The engine "node" is incompatible with this module. Expected version ">=12.13.0 <17.0". Got "22.11.0"'],
        ['output' => 'error Found incompatible module.'],
    ], JSON_THROW_ON_ERROR);

    expect($repair->logsToText($logs))->toContain('Expected version ">=12.13.0 <17.0"');
});

it('does not queue a second auto-repair for the same commit and version', function () {
    Cache::flush();
    Bus::fake([ApplicationDeploymentJob::class]);

    $queue = ApplicationDeploymentQueue::create([
        'application_id' => $this->application->id,
        'deployment_uuid' => 'failed-node-engine',
        'commit' => 'abc123',
        'status' => 'failed',
        'pull_request_id' => 0,
        'logs' => json_encode([
            ['output' => 'The engine "node" is incompatible with this module. Expected version ">=12.13.0 <17.0". Got "22.11.0"'],
        ], JSON_THROW_ON_ERROR),
    ]);

    $repair = app(NixpacksNodeVersionAutoRepair::class);

    expect($repair->repairAndRedeploy($this->application, $queue))->toBe('16')
        ->and($repair->repairAndRedeploy($this->application->fresh(), $queue->fresh()))->toBeNull();
});
