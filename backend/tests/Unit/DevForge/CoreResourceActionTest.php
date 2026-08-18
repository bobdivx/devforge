<?php

use App\Actions\Application\RestartApplication;
use App\Models\Application;
use App\Models\Server;
use App\Models\StandaloneDocker;
use App\Services\DevForge\Core\CoreResourceAction;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\Cache;

beforeEach(function () {
    Cache::flush();
    Bus::fake();
});

it('restarts an application without queueing a deployment', function () {
    RestartApplication::shouldRun()->once()->andReturn(1);

    $server = Mockery::mock(Server::class)->makePartial();
    $server->shouldReceive('isSwarm')->andReturn(false);
    $destination = new StandaloneDocker;
    $destination->setRelation('server', $server);

    $application = Mockery::mock(Application::class)->makePartial();
    $application->uuid = 'app-restart-1';
    $application->setRelation('destination', $destination);
    $application->setRelation('environment', null);
    $application->shouldReceive('update')
        ->once()
        ->with(['status' => 'restarting'])
        ->andReturn(true);

    $result = app(CoreResourceAction::class)->execute($application, 'applications', 'restart', []);

    expect($result['queued'])->toBeFalse()
        ->and($result['completed'])->toBeTrue()
        ->and($result)->not->toHaveKey('deployment_uuid')
        ->and($result['message'])->toBe('Application redémarrée.');
});

it('marks an application as exited immediately when stopping', function () {
    $application = Mockery::mock(Application::class)->makePartial();
    $application->uuid = 'app-stop-1';
    $application->setRelation('environment', null);
    $application->shouldReceive('update')
        ->once()
        ->with(['status' => 'exited'])
        ->andReturn(true);

    $result = app(CoreResourceAction::class)->execute($application, 'applications', 'stop', []);

    expect($result['queued'])->toBeTrue()
        ->and($result)->not->toHaveKey('deployment_uuid');
});
