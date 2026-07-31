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
