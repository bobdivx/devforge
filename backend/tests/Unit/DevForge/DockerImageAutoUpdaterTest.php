<?php

use App\Services\DevForge\Docker\DockerImageAutoUpdater;
use App\Services\DevForge\Docker\DockerImageUpdateChecker;

test('shouldAutoApply requires running_digest and update_available', function () {
    $updater = new DockerImageAutoUpdater(Mockery::mock(DockerImageUpdateChecker::class));

    expect($updater->shouldAutoApply([
        'ok' => true,
        'update_available' => true,
        'comparison' => 'running_digest',
    ]))->toBeTrue();

    expect($updater->shouldAutoApply([
        'ok' => true,
        'update_available' => true,
        'comparison' => 'semver',
    ]))->toBeFalse();

    expect($updater->shouldAutoApply([
        'ok' => true,
        'update_available' => false,
        'comparison' => 'running_digest',
    ]))->toBeFalse();

    expect($updater->shouldAutoApply([
        'ok' => true,
        'update_available' => null,
        'comparison' => 'floating_tag',
    ]))->toBeFalse();
});
