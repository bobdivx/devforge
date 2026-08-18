<?php

use App\Services\DevForge\InstanceUpgradeService;
use Illuminate\Support\Carbon;

it('marks an update as available when a newer version is flagged', function () {
    $resolved = InstanceUpgradeService::resolveAvailability(
        '4.0.0-beta.998',
        '4.0.0-beta.999',
        flagged: true,
        cloud: false,
    );

    expect($resolved['available'])->toBeTrue()
        ->and($resolved['stale_flag'])->toBeFalse()
        ->and($resolved['current_version'])->toBe('4.0.0-beta.998')
        ->and($resolved['latest_version'])->toBe('4.0.0-beta.999');
});

it('ignores the update flag in cloud and when versions are not newer', function (string $current, string $latest, bool $flagged, bool $cloud, bool $available, bool $stale) {
    $resolved = InstanceUpgradeService::resolveAvailability($current, $latest, $flagged, $cloud);

    expect($resolved['available'])->toBe($available)
        ->and($resolved['stale_flag'])->toBe($stale);
})->with([
    'same version' => ['4.0.0-beta.999', '4.0.0-beta.999', true, false, false, true],
    'older latest' => ['4.0.0-beta.1000', '4.0.0-beta.999', true, false, false, true],
    'not flagged' => ['4.0.0-beta.998', '4.0.0-beta.999', false, false, false, false],
    'cloud' => ['4.0.0-beta.998', '4.0.0-beta.999', true, true, false, false],
]);

it('parses an in-progress upgrade status file', function () {
    $now = Carbon::parse('2026-08-17 20:00:00');
    $parsed = InstanceUpgradeService::parseStatusFile(
        '3|Pulling DevForge image...|2026-08-17 19:58:00',
        $now,
    );

    expect($parsed['status'])->toBe('in_progress')
        ->and($parsed['step'])->toBe(3)
        ->and($parsed['message'])->toBe('Pulling DevForge image...');
});

it('parses a completed upgrade status file', function () {
    $now = Carbon::parse('2026-08-17 20:00:00');
    $parsed = InstanceUpgradeService::parseStatusFile(
        '6|Upgrade complete|2026-08-17 19:59:00',
        $now,
    );

    expect($parsed['status'])->toBe('complete')
        ->and($parsed['step'])->toBe(6);
});

it('parses an error upgrade status file', function () {
    $now = Carbon::parse('2026-08-17 20:00:00');
    $parsed = InstanceUpgradeService::parseStatusFile(
        'error|curl failed|2026-08-17 19:59:00',
        $now,
    );

    expect($parsed['status'])->toBe('error')
        ->and($parsed['step'])->toBe(0)
        ->and($parsed['message'])->toBe('curl failed');
});

it('uses the DevForge versions feed instead of the Coolify CDN', function () {
    expect(config('constants.coolify.versions_url'))
        ->toContain('bobdivx/devforge')
        ->and(config('constants.coolify.versions_url'))
        ->not->toContain('/coolify/versions.json')
        ->and(config('constants.coolify.upgrade_script_url'))
        ->toContain('bobdivx/devforge')
        ->and(config('constants.coolify.upgrade_script_url'))
        ->not->toContain('/coolify/upgrade.sh');
});

it('ignores empty, invalid or stale upgrade status files', function (?string $content) {
    $now = Carbon::parse('2026-08-17 20:00:00');

    expect(InstanceUpgradeService::parseStatusFile($content, $now))->toBe([
        'status' => 'none',
        'step' => 0,
        'message' => null,
    ]);
})->with([
    'empty' => [''],
    'null' => [null],
    'incomplete' => ['1|starting'],
    'stale' => ['2|Pulling|2026-08-17 19:40:00'],
]);
