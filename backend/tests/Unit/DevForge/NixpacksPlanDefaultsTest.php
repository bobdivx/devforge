<?php

use App\Services\DevForge\Application\NixpacksPlanDefaults;

it('adds unzip and skips puppeteer chrome download for node plans', function () {
    $plan = (new NixpacksPlanDefaults)->apply([
        'phases' => [
            'setup' => [
                'aptPkgs' => ['libnss3', 'chromium'],
            ],
        ],
        'variables' => [
            'NIXPACKS_NODE_VERSION' => '22',
        ],
    ], 'node');

    expect($plan['phases']['setup']['aptPkgs'])->toContain('curl')
        ->and($plan['phases']['setup']['aptPkgs'])->toContain('wget')
        ->and($plan['phases']['setup']['aptPkgs'])->toContain('unzip')
        ->and($plan['phases']['setup']['aptPkgs'])->toContain('chromium')
        ->and($plan['variables']['PUPPETEER_SKIP_DOWNLOAD'])->toBe('true')
        ->and($plan['variables']['PUPPETEER_SKIP_CHROMIUM_DOWNLOAD'])->toBe('true')
        ->and($plan['variables']['NIXPACKS_NODE_VERSION'])->toBe('22');
});

it('omits puppeteer skip vars when the application setting is off', function () {
    $plan = (new NixpacksPlanDefaults)->apply([
        'variables' => [
            'PUPPETEER_SKIP_DOWNLOAD' => 'true',
            'NIXPACKS_NODE_VERSION' => '22',
        ],
    ], 'node', false);

    expect($plan['variables'])->not->toHaveKey('PUPPETEER_SKIP_DOWNLOAD')
        ->and($plan['variables'])->not->toHaveKey('PUPPETEER_SKIP_CHROMIUM_DOWNLOAD')
        ->and($plan['variables']['NIXPACKS_NODE_VERSION'])->toBe('22');
});

it('does not inject puppeteer vars for non-node plans', function () {
    $plan = (new NixpacksPlanDefaults)->apply([
        'variables' => [],
    ], 'php');

    expect($plan['variables'])->not->toHaveKey('PUPPETEER_SKIP_DOWNLOAD')
        ->and($plan['phases']['setup']['aptPkgs'])->toContain('unzip');
});

it('pins a nixpkgs archive that actually contains nodejs_24', function () {
    $legacy = 'ffeebf0acf3ae8b29f8c7049cd911b9636efd7e7';
    $plan = (new NixpacksPlanDefaults)->apply([
        'nixpkgsArchive' => $legacy,
        'phases' => [
            'setup' => [
                'nixPkgs' => ['nodejs_24', 'npm-9_x'],
                'nixpkgsArchive' => $legacy,
            ],
        ],
        'variables' => [
            'NIXPACKS_NODE_VERSION' => '24',
        ],
    ], 'node');

    $archive = NixpacksPlanDefaults::NODE_NIXPKGS_ARCHIVES['24'];

    expect($plan['nixpkgsArchive'])->toBe($archive)
        ->and($plan['phases']['setup']['nixpkgsArchive'])->toBe($archive)
        ->and($plan['nixpkgsArchive'])->not->toBe($legacy);
});

it('pins the node 22 nixpkgs archive from current nixpacks', function () {
    $plan = (new NixpacksPlanDefaults)->apply([
        'phases' => [
            'setup' => [
                'nixPkgs' => ['nodejs_22', 'npm-9_x'],
            ],
        ],
        'variables' => [
            'NIXPACKS_NODE_VERSION' => '22',
        ],
    ], 'node');

    expect($plan['nixpkgsArchive'])->toBe(NixpacksPlanDefaults::NODE_NIXPKGS_ARCHIVES['22']);
});
