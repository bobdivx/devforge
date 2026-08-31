<?php

use App\Actions\Server\UpdateDevForge;
use App\Models\InstanceSettings;
use App\Models\Server;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;

beforeEach(function () {
    // Mock Server
    $this->mockServer = Mockery::mock(Server::class)->makePartial();
    $this->mockServer->id = 0;

    // Mock InstanceSettings
    $this->settings = Mockery::mock(InstanceSettings::class);
    $this->settings->is_auto_update_enabled = true;
    $this->settings->shouldReceive('save')->andReturn(true);
});

afterEach(function () {
    Mockery::close();
});

it('has UpdateDevForge action class', function () {
    expect(class_exists(UpdateDevForge::class))->toBeTrue();
});

it('validates target version and prevents downgrade', function () {
    Server::shouldReceive('find')
        ->with(0)
        ->andReturn($this->mockServer);

    $this->app->instance('App\Models\InstanceSettings', function () {
        return $this->settings;
    });

    config(['constants.devforge.version' => '4.1.31']);

    $action = new UpdateDevForge;

    try {
        $action->handle(manual_update: true, targetVersion: '4.1.15');
        expect(false)->toBeTrue('Expected downgrade exception');
    } catch (\Exception $e) {
        expect($e->getMessage())->toContain('Cannot downgrade from 4.1.31 to 4.1.15');
    }
});
