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
