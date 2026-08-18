<?php

use App\Models\Application;
use App\Models\Team;
use App\Services\DevForge\Application\ApplicationBootSequenceService;
use App\Services\DevForge\Application\ApplicationDesiredRuntimeState;
use App\Services\DevForge\Application\ApplicationKeepAliveService;
use App\Services\DevForge\Core\CoreResourceAction;
use App\Services\DevForge\Core\CoreResourceCatalog;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Cache;
use Mockery;

beforeEach(function () {
    Cache::flush();
    config()->set('devforge.enabled', true);
    config()->set('devforge.application_boot_sequence.enabled', true);
    config()->set('devforge.application_boot_sequence.window_seconds', 900);
    config()->set('devforge.application_boot_sequence.item_timeout_seconds', 300);
    config()->set('devforge.application_boot_sequence.poll_interval_ms', 2500);
    config()->set('devforge.application_keep_alive.enabled', true);
});

function makeKeepAliveApplication(string $uuid, string $name, string $status): Application
{
    $application = Mockery::mock(Application::class)->makePartial();
    $application->uuid = $uuid;
    $application->name = $name;
    $application->status = $status;

    return $application;
}

it('restarts desired stopped applications via the boot sequence', function () {
    $team = Team::factory()->make(['id' => 21]);
    $stopped = makeKeepAliveApplication('app-keep-1', 'Keep', 'exited:unhealthy');

    $desired = new ApplicationDesiredRuntimeState;
    $desired->markDesiredRunning($stopped);

    $catalog = Mockery::mock(CoreResourceCatalog::class);
    $catalog->shouldReceive('resources')
        ->with($team, 'applications')
        ->andReturn(new Collection([$stopped]));

    $action = Mockery::mock(CoreResourceAction::class);
    $action->shouldReceive('execute')
        ->once()
        ->with($stopped, 'applications', 'deploy', Mockery::type('array'))
        ->andReturn([
            'queued' => true,
            'deployment_uuid' => 'deploy-keep',
            'message' => 'queued',
        ]);

    $boot = new ApplicationBootSequenceService($catalog, $action, $desired);
    $keepAlive = new ApplicationKeepAliveService($catalog, $boot, $desired);

    $keepAlive->tickTeam($team);
    $status = $boot->statusForTeam($team, ensure: false);

    expect($status['active'])->toBeTrue()
        ->and($status['current_uuid'])->toBe('app-keep-1')
        ->and($status['items'][0]['phase'])->toBe('starting');
});

it('does not restart an application stopped on purpose', function () {
    $team = Team::factory()->make(['id' => 22]);
    $stopped = makeKeepAliveApplication('app-keep-2', 'Paused', 'exited:unhealthy');

    $desired = new ApplicationDesiredRuntimeState;
    $desired->markDesiredStopped($stopped);

    $catalog = Mockery::mock(CoreResourceCatalog::class);
    $catalog->shouldReceive('resources')
        ->with($team, 'applications')
        ->andReturn(new Collection([$stopped]));

    $action = Mockery::mock(CoreResourceAction::class);
    $action->shouldReceive('execute')->never();

    $boot = new ApplicationBootSequenceService($catalog, $action, $desired);
    $keepAlive = new ApplicationKeepAliveService($catalog, $boot, $desired);

    $keepAlive->tickTeam($team);
    $status = $boot->statusForTeam($team, ensure: false);

    expect($status['active'])->toBeFalse()
        ->and($status['items'])->toBe([]);
});

it('does not treat a still-running container as desired running after a manual stop', function () {
    $team = Team::factory()->make(['id' => 23]);
    $running = makeKeepAliveApplication('app-keep-3', 'Stopping', 'running:unhealthy');

    $desired = new ApplicationDesiredRuntimeState;
    $desired->markDesiredStopped($running);

    $catalog = Mockery::mock(CoreResourceCatalog::class);
    $catalog->shouldReceive('resources')
        ->with($team, 'applications')
        ->andReturn(new Collection([$running]));

    $action = Mockery::mock(CoreResourceAction::class);
    $action->shouldReceive('execute')->never();

    $boot = new ApplicationBootSequenceService($catalog, $action, $desired);
    $keepAlive = new ApplicationKeepAliveService($catalog, $boot, $desired);

    $keepAlive->tickTeam($team);

    expect($desired->isDesiredRunning($running))->toBeFalse();

    $status = $boot->statusForTeam($team, ensure: false);

    expect($status['active'])->toBeFalse()
        ->and($status['items'])->toBe([]);
});
