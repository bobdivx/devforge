<?php

use App\Jobs\DevForge\CheckDockerImageUpdatesJob;
use App\Services\DevForge\Docker\DockerImageAutoUpdater;

test('CheckDockerImageUpdatesJob delegates to DockerImageAutoUpdater', function () {
    $updater = Mockery::mock(DockerImageAutoUpdater::class);
    $updater->shouldReceive('run')
        ->once()
        ->andReturn([
            'checked' => 0,
            'updated' => 0,
            'skipped' => 0,
            'errors' => 0,
            'results' => [],
        ]);

    (new CheckDockerImageUpdatesJob)->handle($updater);
});
