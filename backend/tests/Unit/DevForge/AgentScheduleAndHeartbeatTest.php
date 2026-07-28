<?php

use App\Models\AiAgent;
use App\Services\DevForge\Agent\AgentStandingOrders;

it('treats empty cron agents as not due without schedule_minutes', function () {
    $agent = new AiAgent([
        'type' => 'debug',
        'is_active' => true,
        'status' => 'idle',
        'schedule_minutes' => 0,
        'schedule_cron' => null,
    ]);

    expect($agent->isDueForScheduledRun())->toBeFalse()
        ->and($agent->triggerMode())->toBe('manual');
});

it('exposes cron trigger mode when schedule_cron is set', function () {
    $agent = new AiAgent([
        'type' => 'debug',
        'is_active' => true,
        'status' => 'idle',
        'schedule_minutes' => 0,
        'schedule_cron' => '0 * * * *',
    ]);

    expect($agent->triggerMode())->toBe('cron');
});

it('requires heartbeat_enabled for heartbeat due check', function () {
    $agent = new AiAgent([
        'type' => 'debug',
        'is_active' => true,
        'status' => 'idle',
        'heartbeat_enabled' => false,
    ]);

    expect($agent->isDueForHeartbeat())->toBeFalse();

    $agent->heartbeat_enabled = true;
    $agent->last_heartbeat_at = null;

    expect($agent->isDueForHeartbeat())->toBeTrue();
});

it('standing orders service reports availability via schema', function () {
    expect(app(AgentStandingOrders::class)->available())->toBeBool();
});
