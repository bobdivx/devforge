<?php

use App\Models\Team;
use App\Services\DevForge\Core\CoreResourceCatalog;
use App\Services\DevForge\Docker\DockerImageUpdateChecker;
use Illuminate\Support\Facades\Http;

test('check_docker_image_update detects newer semver on docker hub', function () {
    Http::fake([
        'https://hub.docker.com/v2/repositories/library/nginx/tags*' => Http::response([
            'results' => [
                ['name' => '1.27.1', 'digest' => 'sha256:aaa'],
                ['name' => '1.25.0', 'digest' => 'sha256:bbb'],
                ['name' => 'latest', 'digest' => 'sha256:aaa'],
            ],
        ], 200),
    ]);

    $checker = new DockerImageUpdateChecker(app(CoreResourceCatalog::class));
    $result = $checker->check(
        team: new Team(['name' => 't']),
        image: 'nginx:1.25.0',
        inspectRunning: false,
    );

    expect($result['ok'])->toBeTrue()
        ->and($result['configured_tag'])->toBe('1.25.0')
        ->and($result['latest_tag'])->toBe('1.27.1')
        ->and($result['up_to_date'])->toBeFalse()
        ->and($result['update_available'])->toBeTrue()
        ->and($result['comparison'])->toBe('semver');
});

test('check_docker_image_update reports up to date when tag is newest semver', function () {
    Http::fake([
        'https://hub.docker.com/v2/repositories/library/redis/tags*' => Http::response([
            'results' => [
                ['name' => '7.4.1', 'digest' => 'sha256:ccc'],
                ['name' => '7.2.0', 'digest' => 'sha256:ddd'],
                ['name' => 'latest', 'digest' => 'sha256:ccc'],
            ],
        ], 200),
    ]);

    $checker = new DockerImageUpdateChecker(app(CoreResourceCatalog::class));
    $result = $checker->check(
        team: new Team(['name' => 't']),
        image: 'redis:7.4.1',
        inspectRunning: false,
    );

    expect($result['ok'])->toBeTrue()
        ->and($result['up_to_date'])->toBeTrue()
        ->and($result['update_available'])->toBeFalse();
});

test('check_docker_image_update marks floating latest as inconclusive without running digest', function () {
    Http::fake([
        'https://hub.docker.com/v2/repositories/library/nginx/tags*' => Http::response([
            'results' => [
                ['name' => '1.27.1', 'digest' => 'sha256:aaa'],
                ['name' => 'latest', 'digest' => 'sha256:aaa'],
            ],
        ], 200),
    ]);

    $checker = new DockerImageUpdateChecker(app(CoreResourceCatalog::class));
    $result = $checker->check(
        team: new Team(['name' => 't']),
        image: 'nginx:latest',
        inspectRunning: false,
    );

    expect($result['ok'])->toBeTrue()
        ->and($result['comparison'])->toBe('floating_tag')
        ->and($result['up_to_date'])->toBeNull()
        ->and($result['latest_tag'])->toBe('1.27.1');
});
