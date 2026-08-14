<?php

use App\Services\DevForge\Github\GithubRunnerCompatibility;

it('parses runner versions from popcorn and official log lines', function (string $text, ?string $expected) {
    expect(GithubRunnerCompatibility::parseVersion($text))->toBe($expected);
})->with([
    'entrypoint version' => ["Initialisation du GitHub Actions Runner...\n   Version: 2.336.0\n   URL: https://github.com/bobdivx/popcorn-server", '2.336.0'],
    'already installed' => ['Runner v2.321.0 deja installe', '2.321.0'],
    'official listener' => ["Current runner version: '2.321.0'", '2.321.0'],
    'empty' => ['', null],
    'unrelated' => ['Listening for Jobs', null],
]);

it('detects node24 support from runner versions', function (string $version, bool $expected) {
    expect(GithubRunnerCompatibility::supportsNode24($version))->toBe($expected);
})->with([
    'old casaos' => ['2.321.0', false],
    'min node24' => ['2.327.1', true],
    'current default' => ['2.336.0', true],
    'garbage' => ['latest', false],
]);

it('bumps incompatible RUNNER_VERSION env lines to the default', function () {
    $env = GithubRunnerCompatibility::withCompatibleRunnerVersion([
        'REPO_URL=https://github.com/bobdivx/popcorn-server',
        'RUNNER_VERSION=2.321.0',
        'TZ=Europe/Paris',
    ]);

    expect($env)
        ->toContain('REPO_URL=https://github.com/bobdivx/popcorn-server')
        ->toContain('RUNNER_VERSION=2.336.0')
        ->toContain('TZ=Europe/Paris')
        ->not->toContain('RUNNER_VERSION=2.321.0');
});

it('injects RUNNER_VERSION when missing from inspect env', function () {
    $env = GithubRunnerCompatibility::withCompatibleRunnerVersion([
        'REPO_URL=https://github.com/bobdivx/popcorn-server',
    ]);

    expect($env)->toContain('RUNNER_VERSION=2.336.0');
});

it('keeps a node24-capable version already present', function () {
    $env = GithubRunnerCompatibility::withCompatibleRunnerVersion([
        'RUNNER_VERSION=2.328.0',
    ]);

    expect($env)->toBe(['RUNNER_VERSION=2.328.0']);
});

it('exposes a payload for the runners page', function () {
    expect(GithubRunnerCompatibility::payload('2.321.0'))
        ->toMatchArray([
            'runner_version' => '2.321.0',
            'node24_ready' => false,
            'node24_min_version' => '2.327.1',
            'recommended_runner_version' => '2.336.0',
        ])
        ->and(GithubRunnerCompatibility::payload(null)['node24_ready'])->toBeNull();
});
