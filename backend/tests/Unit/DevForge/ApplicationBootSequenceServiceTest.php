<?php

use App\Models\Application;
use App\Models\Team;
use App\Services\DevForge\Application\ApplicationBootSequenceService;
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
});

function makeBootService(?CoreResourceCatalog $catalog = null, ?CoreResourceAction $action = null): ApplicationBootSequenceService
{
    return new ApplicationBootSequenceService(
        $catalog ?? Mockery::mock(CoreResourceCatalog::class),
        $action ?? Mockery::mock(CoreResourceAction::class),
    );
}

function makeApplication(string $uuid, string $name, string $status): Application
{
    $application = Mockery::mock(Application::class)->makePartial();
    $application->uuid = $uuid;
    $application->name = $name;
    $application->status = $status;

    return $application;
}

it('returns idle payload when disabled', function () {
    config()->set('devforge.application_boot_sequence.enabled', false);
    $team = Team::factory()->make(['id' => 7]);

    $status = makeBootService()->statusForTeam($team, ensure: false);

    expect($status['active'])->toBeFalse()
        ->and($status['status'])->toBe('idle')
        ->and($status['items'])->toBe([]);
});

it('starts a sequence and reveals already running apps one by one', function () {
    $team = Team::factory()->make(['id' => 11]);
    $first = makeApplication('app-1', 'Alpha', 'running:healthy');
    $second = makeApplication('app-2', 'Beta', 'running:healthy');

    $catalog = Mockery::mock(CoreResourceCatalog::class);
    $catalog->shouldReceive('resources')
        ->with($team, 'applications')
        ->andReturn(new Collection([$first, $second]));

    $action = Mockery::mock(CoreResourceAction::class);
    $action->shouldReceive('execute')->never();

    $service = makeBootService($catalog, $action);

    // Force begin despite all running by calling begin directly.
    $service->begin($team, [$first, $second]);
    $service->tickTeam($team);
    $firstTick = $service->statusForTeam($team, ensure: false);

    expect($firstTick['active'])->toBeTrue()
        ->and($firstTick['completed'])->toBe(1)
        ->and($firstTick['items'][0]['phase'])->toBe('running')
        ->and($firstTick['items'][1]['phase'])->toBe('waiting');

    $service->tickTeam($team);
    $secondTick = $service->statusForTeam($team, ensure: false);

    expect($secondTick['active'])->toBeFalse()
        ->and($secondTick['status'])->toBe('completed')
        ->and($secondTick['completed'])->toBe(2)
        ->and($secondTick['items'][1]['phase'])->toBe('running');
});

it('queues deploy for the next stopped application only', function () {
    $team = Team::factory()->make(['id' => 12]);
    $first = makeApplication('app-1', 'Alpha', 'exited:unhealthy');
    $second = makeApplication('app-2', 'Beta', 'exited:unhealthy');

    $catalog = Mockery::mock(CoreResourceCatalog::class);
    $catalog->shouldReceive('resources')
        ->with($team, 'applications')
        ->andReturn(new Collection([$first, $second]));

    $action = Mockery::mock(CoreResourceAction::class);
    $action->shouldReceive('execute')
        ->once()
        ->with($first, 'applications', 'deploy', Mockery::on(fn (array $options): bool => ($options['instant_deploy'] ?? false) === true))
        ->andReturn([
            'queued' => true,
            'deployment_uuid' => 'deploy-1',
            'message' => 'Application deployment request queued.',
        ]);

    $service = makeBootService($catalog, $action);
    $service->begin($team, [$first, $second]);
    $service->tickTeam($team);
    $status = $service->statusForTeam($team, ensure: false);

    expect($status['active'])->toBeTrue()
        ->and($status['current_uuid'])->toBe('app-1')
        ->and($status['items'][0]['phase'])->toBe('starting')
        ->and($status['items'][1]['phase'])->toBe('waiting');
});

it('does not auto-start a single stopped app while others are already running', function () {
    $team = Team::factory()->make(['id' => 13]);
    $running = makeApplication('app-1', 'Alpha', 'running:healthy');
    $stopped = makeApplication('app-2', 'Beta', 'exited:unhealthy');

    $catalog = Mockery::mock(CoreResourceCatalog::class);
    $catalog->shouldReceive('resources')
        ->with($team, 'applications')
        ->andReturn(new Collection([$running, $stopped]));

    $action = Mockery::mock(CoreResourceAction::class);
    $action->shouldReceive('execute')->never();

    $status = makeBootService($catalog, $action)->statusForTeam($team, ensure: true);

    expect($status['active'])->toBeFalse()
        ->and($status['status'])->toBe('idle');
});
