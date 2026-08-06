<?php

use App\Services\DevForge\Github\GithubAppCatalog;
use App\Services\DevForge\Github\GithubRunnerInventory;

it('detects github runner containers by name image and labels', function (array $container, bool $expected) {
    $inventory = new GithubRunnerInventory(Mockery::mock(GithubAppCatalog::class));

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
    $inventory = new GithubRunnerInventory(Mockery::mock(GithubAppCatalog::class));

    expect($inventory->parseRepoUrl($url))->toBe($expected);
})->with([
    'https url' => ['https://github.com/bobdivx/popcorn-client', ['owner' => 'bobdivx', 'repo' => 'popcorn-client']],
    'git suffix' => ['https://github.com/bobdivx/popcorn-server.git', ['owner' => 'bobdivx', 'repo' => 'popcorn-server']],
    'ssh style' => ['git@github.com:bobdivx/popcorn-tauri.git', ['owner' => 'bobdivx', 'repo' => 'popcorn-tauri']],
    'empty' => [null, null],
    'invalid' => ['https://example.com/nope', null],
]);

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

    $inventory = new GithubRunnerInventory($catalog);

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

    $inventory = new GithubRunnerInventory($catalog);

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
    $inventory = new GithubRunnerInventory(Mockery::mock(GithubAppCatalog::class));

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
        ->toContain(escapeshellarg('ghcr.io/bobdivx/popcorn-github-runner-client:latest'));
});

it('builds host network mode for server runners', function () {
    $inventory = new GithubRunnerInventory(Mockery::mock(GithubAppCatalog::class));

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

it('builds pat auth without runner_token env', function () {
    $inventory = new GithubRunnerInventory(Mockery::mock(GithubAppCatalog::class));

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
