<?php

use App\Services\DevForge\Github\GithubAppCatalog;
use App\Services\DevForge\Github\GithubRunnerInventory;

it('detects github runner containers by name image and labels', function (array $container, bool $expected) {
    $inventory = new GithubRunnerInventory(Mockery::mock(GithubAppCatalog::class), Mockery::mock(App\Services\DevForge\Github\GithubRunnerApplicationLinker::class));

    expect($inventory->isGithubRunnerContainer($container))->toBe($expected);
})->with([
    'client runner name' => [[
        'Names' => 'github-runner-client',
        'Image' => 'ghcr.io/bobdivx/popcorn-github-runner-client:latest',
        'Labels' => 'com.casaos.app_id=github-runners',
    ], true],
    'comma separated names' => [[
        'Names' => '/github-runner-client,github-runner-client',
        'Image' => 'ghcr.io/bobdivx/popcorn-github-runner-client:latest',
        'Labels' => 'com.casaos.app_id=github-runners',
    ], true],
    'server runner name' => [[
        'Names' => '/github-runner-server',
        'Image' => 'alpine:latest',
        'Labels' => '',
    ], true],
    'actions runner image' => [[
        'Names' => 'build-worker',
        'Image' => 'myoung34/github-runner:latest',
        'Labels' => '',
    ], true],
    'casaos label' => [[
        'Names' => 'custom-name',
        'Image' => 'custom:latest',
        'Labels' => 'com.casaos.app_id=github-runners,icon=https://example.com',
    ], true],
    'devforge label' => [[
        'Names' => 'custom-runner',
        'Image' => 'custom:latest',
        'Labels' => 'com.devforge.runner=true',
    ], true],
    'unrelated container' => [[
        'Names' => 'devforge-api',
        'Image' => 'bobdivx/devforge:api',
        'Labels' => 'com.casaos.app_id=devforge',
    ], false],
    'postgres' => [[
        'Names' => 'postgres',
        'Image' => 'postgres:15',
        'Labels' => '',
    ], false],
]);

it('parses github repository urls', function (?string $url, ?array $expected) {
    $inventory = new GithubRunnerInventory(Mockery::mock(GithubAppCatalog::class), Mockery::mock(App\Services\DevForge\Github\GithubRunnerApplicationLinker::class));

    expect($inventory->parseRepoUrl($url))->toBe($expected);
})->with([
    'https url ending with t' => ['https://github.com/bobdivx/popcorn-client', ['owner' => 'bobdivx', 'repo' => 'popcorn-client']],
    'https url ending with i' => ['https://github.com/bobdivx/popcorn-tauri', ['owner' => 'bobdivx', 'repo' => 'popcorn-tauri']],
    'git suffix' => ['https://github.com/bobdivx/popcorn-server.git', ['owner' => 'bobdivx', 'repo' => 'popcorn-server']],
    'ssh style' => ['git@github.com:bobdivx/popcorn-tauri.git', ['owner' => 'bobdivx', 'repo' => 'popcorn-tauri']],
    'empty' => [null, null],
    'invalid' => ['https://example.com/nope', null],
]);

it('uses a lean docker discovery command set', function () {
    $inventory = new GithubRunnerInventory(Mockery::mock(GithubAppCatalog::class), Mockery::mock(App\Services\DevForge\Github\GithubRunnerApplicationLinker::class));

    $commands = $inventory->discoveryDockerCommands();

    expect($commands)->toHaveCount(1)
        ->and($commands[0])->toContain('name=github-runner')
        ->and(implode("\n", $commands))->not->toContain('com.casaos.app_id=github-runners');
});

it('enriches docker runners with github online busy offline status', function () {
    Illuminate\Support\Facades\Cache::flush();

    $catalog = Mockery::mock(GithubAppCatalog::class);
    $catalog->shouldReceive('appsForTeam')->once()->andReturn(collect([(object) ['uuid' => 'app-1']]));
    $catalog->shouldReceive('runners')
        ->once()
        ->with(Mockery::any(), 'bobdivx', 'popcorn-client')
        ->andReturn([
            [
                'id' => 42,
                'name' => 'casaos-runner-popcorn-client',
                'os' => 'linux',
                'status' => 'online',
                'busy' => true,
                'labels' => ['self-hosted'],
            ],
        ]);

    $inventory = new GithubRunnerInventory($catalog, Mockery::mock(App\Services\DevForge\Github\GithubRunnerApplicationLinker::class));

    $enriched = $inventory->enrichWithGithubStatus(
        Mockery::mock(\App\Models\Team::class),
        collect([[
            'id' => 'srv:github-runner-client',
            'name' => 'github-runner-client',
            'runner_name' => 'casaos-runner-popcorn-client',
            'repo_url' => 'https://github.com/bobdivx/popcorn-client',
            'server_name' => 'zimacube',
        ]]),
        allowColdFetch: true,
    )->first();

    expect($enriched['github_status'])->toBe('busy')
        ->and($enriched['github_busy'])->toBeTrue()
        ->and($enriched['github_runner_id'])->toBe(42)
        ->and($enriched['source'])->toBe('both');
});

it('skips cold github api fetches when listing', function () {
    Illuminate\Support\Facades\Cache::flush();

    $catalog = Mockery::mock(GithubAppCatalog::class);
    $catalog->shouldReceive('appsForTeam')->once()->andReturn(collect([(object) ['uuid' => 'app-1']]));
    $catalog->shouldReceive('runners')->never();

    $inventory = new GithubRunnerInventory($catalog, Mockery::mock(App\Services\DevForge\Github\GithubRunnerApplicationLinker::class));

    $enriched = $inventory->enrichWithGithubStatus(
        Mockery::mock(\App\Models\Team::class),
        collect([[
            'id' => 'srv:github-runner-client',
            'name' => 'github-runner-client',
            'runner_name' => 'casaos-runner-popcorn-client',
            'repo_url' => 'https://github.com/bobdivx/popcorn-client',
            'server_name' => 'zimacube',
        ]]),
        allowColdFetch: false,
    )->first();

    expect($enriched['github_status'])->toBeNull()
        ->and($enriched['github_repo'])->toBe('bobdivx/popcorn-client')
        ->and($enriched['source'])->toBe('docker');
});

it('builds docker run commands with volumes network and timezone', function () {
    $inventory = new GithubRunnerInventory(Mockery::mock(GithubAppCatalog::class), Mockery::mock(App\Services\DevForge\Github\GithubRunnerApplicationLinker::class));

    $command = $inventory->buildDockerRunCommand(
        containerName: 'github-runner-client',
        image: 'ghcr.io/bobdivx/popcorn-github-runner-client:latest',
        repoUrl: 'https://github.com/bobdivx/popcorn-client',
        runnerName: 'casaos-runner-popcorn-client',
        authToken: 'REGISTRATION_TOKEN',
        authMode: 'registration',
        labels: 'self-hosted,popcorn',
        networkMode: 'bridge',
        timezone: 'Europe/Paris',
        replaceExisting: true,
        volumes: [
            '/media/Docker/AppData/runner/client:/shared-data',
            '/media/Docker/AppData/runner/npm:/home/runner/.npm',
        ],
        extraEnv: [
            ['key' => 'ANDROID_HOME', 'value' => '/opt/android-sdk'],
        ],
    );

    expect($command)
        ->toContain('--name '.escapeshellarg('github-runner-client'))
        ->toContain('--network '.escapeshellarg('bridge'))
        ->toContain('-v '.escapeshellarg('/media/Docker/AppData/runner/client:/shared-data'))
        ->toContain('-e '.escapeshellarg('TZ=Europe/Paris'))
        ->toContain('-e '.escapeshellarg('RUNNER_REPLACE_EXISTING=true'))
        ->toContain('-e '.escapeshellarg('ANDROID_HOME=/opt/android-sdk'))
        ->toContain('-e '.escapeshellarg('RUNNER_TOKEN=REGISTRATION_TOKEN'))
        ->toContain('-e '.escapeshellarg('ACCESS_TOKEN=REGISTRATION_TOKEN'))
        ->toContain('-e '.escapeshellarg('RUNNER_LABELS=self-hosted,popcorn'))
        ->toContain('-e '.escapeshellarg('RUNNER_VERSION=2.336.0'))
        ->toContain('--label '.escapeshellarg('devforge.managed=true'))
        ->toContain('--label '.escapeshellarg('devforge.type=service'))
        ->toContain(escapeshellarg('ghcr.io/bobdivx/popcorn-github-runner-client:latest'));
});

it('builds host network mode for server runners', function () {
    $inventory = new GithubRunnerInventory(Mockery::mock(GithubAppCatalog::class), Mockery::mock(App\Services\DevForge\Github\GithubRunnerApplicationLinker::class));

    $command = $inventory->buildDockerRunCommand(
        containerName: 'github-runner-server',
        image: 'ghcr.io/bobdivx/popcorn-github-runner-server:latest',
        repoUrl: 'https://github.com/bobdivx/popcorn-server',
        runnerName: 'casaos-runner-popcorn-server',
        authToken: 'TOKEN',
        authMode: 'registration',
        networkMode: 'host',
    );

    expect($command)->toContain('--network '.escapeshellarg('host'));
});

it('maps registration tokens to runner_token only for myoung34', function () {
    $inventory = new GithubRunnerInventory(Mockery::mock(GithubAppCatalog::class), Mockery::mock(App\Services\DevForge\Github\GithubRunnerApplicationLinker::class));

    expect($inventory->authEnvironmentVariables('myoung34/github-runner:latest', 'registration', 'REGISTRATION_TOKEN'))
        ->toBe(['RUNNER_TOKEN' => 'REGISTRATION_TOKEN'])
        ->and($inventory->authEnvironmentVariables('ghcr.io/bobdivx/popcorn-github-runner-client:latest', 'registration', 'REGISTRATION_TOKEN'))
        ->toHaveKeys(['RUNNER_TOKEN', 'ACCESS_TOKEN', 'PAT_TOKEN']);
});

it('does not pass a registration token as ACCESS_TOKEN to myoung34', function () {
    $inventory = new GithubRunnerInventory(Mockery::mock(GithubAppCatalog::class), Mockery::mock(App\Services\DevForge\Github\GithubRunnerApplicationLinker::class));

    $command = $inventory->buildDockerRunCommand(
        containerName: 'github-runner-tauri',
        image: 'myoung34/github-runner:latest',
        repoUrl: 'https://github.com/bobdivx/popcorn-tauri',
        runnerName: 'devforge-runner-popcorn-tauri',
        authToken: 'REGISTRATION_TOKEN',
        authMode: 'registration',
    );

    expect($command)
        ->toContain('-e '.escapeshellarg('RUNNER_TOKEN=REGISTRATION_TOKEN'))
        ->not->toContain('ACCESS_TOKEN=')
        ->not->toContain('PAT_TOKEN=');
});

it('strips a registration token copied into ACCESS_TOKEN when recreating myoung34', function () {
    $inventory = new GithubRunnerInventory(Mockery::mock(GithubAppCatalog::class), Mockery::mock(App\Services\DevForge\Github\GithubRunnerApplicationLinker::class));

    $command = $inventory->buildDockerRunFromInspect([
        'Config' => [
            'Image' => 'myoung34/github-runner:latest',
            'Env' => [
                'REPO_URL=https://github.com/bobdivx/popcorn-tauri',
                'RUNNER_NAME=devforge-runner-popcorn-tauri',
                'RUNNER_TOKEN=REGISTRATION_TOKEN',
                'ACCESS_TOKEN=REGISTRATION_TOKEN',
                'PAT_TOKEN=REGISTRATION_TOKEN',
            ],
            'Labels' => [
                'com.devforge.runner' => 'true',
            ],
        ],
        'HostConfig' => [
            'NetworkMode' => 'bridge',
            'Privileged' => true,
            'RestartPolicy' => ['Name' => 'unless-stopped'],
            'Binds' => ['/var/run/docker.sock:/var/run/docker.sock'],
        ],
    ], 'github-runner-devforge-runner-popcorn-tauri');

    expect($command)
        ->toContain('-e '.escapeshellarg('RUNNER_TOKEN=REGISTRATION_TOKEN'))
        ->not->toContain('ACCESS_TOKEN=')
        ->not->toContain('PAT_TOKEN=');
});

it('keeps a real PAT on myoung34 inspect recreate', function () {
    $inventory = new GithubRunnerInventory(Mockery::mock(GithubAppCatalog::class), Mockery::mock(App\Services\DevForge\Github\GithubRunnerApplicationLinker::class));

    $sanitized = $inventory->sanitizeInspectEnvLines('myoung34/github-runner:latest', [
        'ACCESS_TOKEN=ghp_exampletoken',
        'PAT_TOKEN=ghp_exampletoken',
        'RUNNER_NAME=devforge-runner-popcorn-tauri',
    ]);

    expect($sanitized)->toContain('ACCESS_TOKEN=ghp_exampletoken')
        ->and($sanitized)->toContain('PAT_TOKEN=ghp_exampletoken');
});

it('treats restarting and exited containers as unhealthy leftovers', function () {
    $inventory = new GithubRunnerInventory(Mockery::mock(GithubAppCatalog::class), Mockery::mock(App\Services\DevForge\Github\GithubRunnerApplicationLinker::class));

    expect($inventory->isUnhealthyContainerStatus('restarting'))->toBeTrue()
        ->and($inventory->isUnhealthyContainerStatus('exited'))->toBeTrue()
        ->and($inventory->isUnhealthyContainerStatus('running'))->toBeFalse();
});

it('builds pat auth without runner_token env', function () {
    $inventory = new GithubRunnerInventory(Mockery::mock(GithubAppCatalog::class), Mockery::mock(App\Services\DevForge\Github\GithubRunnerApplicationLinker::class));

    $command = $inventory->buildDockerRunCommand(
        containerName: 'github-runner-client',
        image: 'ghcr.io/bobdivx/popcorn-github-runner-client:latest',
        repoUrl: 'https://github.com/bobdivx/popcorn-client',
        runnerName: 'casaos-runner-popcorn-client',
        authToken: 'ghp_exampletoken',
        authMode: 'pat',
    );

    expect($command)
        ->toContain('-e '.escapeshellarg('ACCESS_TOKEN=ghp_exampletoken'))
        ->toContain('-e '.escapeshellarg('PAT_TOKEN=ghp_exampletoken'))
        ->toContain('--label '.escapeshellarg('com.devforge.runner.auth_mode=pat'))
        ->not->toContain('RUNNER_TOKEN=');
});

it('disconnects leftover docker network endpoints before recreate', function () {
    $inventory = new GithubRunnerInventory(Mockery::mock(GithubAppCatalog::class), Mockery::mock(App\Services\DevForge\Github\GithubRunnerApplicationLinker::class));

    $commands = $inventory->staleNetworkCleanupCommands('github-runner-popcorn-server', 'host');

    expect($commands)->toHaveCount(2)
        ->and($commands[0])->toContain('docker network disconnect -f '.escapeshellarg('host'))
        ->and($commands[0])->toContain(escapeshellarg('github-runner-popcorn-server'))
        ->and($commands[1])->toContain('docker network disconnect -f '.escapeshellarg('bridge'));
});

it('rebuilds docker run from inspect and bumps an old RUNNER_VERSION', function () {
    $inventory = new GithubRunnerInventory(Mockery::mock(GithubAppCatalog::class), Mockery::mock(App\Services\DevForge\Github\GithubRunnerApplicationLinker::class));

    $command = $inventory->buildDockerRunFromInspect([
        'Config' => [
            'Image' => 'ghcr.io/bobdivx/popcorn-github-runner-server:latest',
            'Env' => [
                'REPO_URL=https://github.com/bobdivx/popcorn-server',
                'RUNNER_NAME=casaos-runner-popcorn-server',
                'RUNNER_VERSION=2.321.0',
                'ACCESS_TOKEN=ghp_secret',
                'TZ=Europe/Paris',
            ],
            'Labels' => [
                'com.casaos.app_id' => 'github-runners',
            ],
        ],
        'HostConfig' => [
            'NetworkMode' => 'host',
            'Privileged' => true,
            'RestartPolicy' => ['Name' => 'unless-stopped'],
            'Binds' => [
                '/var/run/docker.sock:/var/run/docker.sock',
                '/media/Docker/AppData/runner/buildx:/home/runner/.docker/buildx',
            ],
        ],
    ], 'github-runner-server');

    expect($command)
        ->toContain('--name '.escapeshellarg('github-runner-server'))
        ->toContain('--network '.escapeshellarg('host'))
        ->toContain('--privileged')
        ->toContain('-v '.escapeshellarg('/var/run/docker.sock:/var/run/docker.sock'))
        ->toContain('-v '.escapeshellarg('/media/Docker/AppData/runner/buildx:/home/runner/.docker/buildx'))
        ->toContain('-e '.escapeshellarg('RUNNER_VERSION=2.336.0'))
        ->not->toContain('RUNNER_VERSION=2.321.0')
        ->toContain('-e '.escapeshellarg('ACCESS_TOKEN=ghp_secret'))
        ->toContain('--label '.escapeshellarg('com.casaos.app_id=github-runners'))
        ->toContain(escapeshellarg('ghcr.io/bobdivx/popcorn-github-runner-server:latest'));
});
