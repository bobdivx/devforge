<?php

use App\Services\DevForge\Application\NixpacksNodeVersionResolver;

$resolver = new NixpacksNodeVersionResolver;

it('picks node 24 when engines require >=22.12 because nixpacks 22 is 22.11.0', function () use ($resolver) {
    expect($resolver->resolveFromSources([
        'engines' => ['node' => '>=22.12.0'],
        'dependencies' => ['astro' => '^6.4.2'],
    ]))->toBe('24')
        ->and($resolver->majorSatisfies('22', '>=22.12.0'))->toBeFalse()
        ->and($resolver->majorSatisfies('24', '>=22.12.0'))->toBeTrue();
});

it('picks node 16 when engines require less than 17', function () use ($resolver) {
    expect($resolver->resolveFromSources([
        'engines' => ['node' => '>=12.13.0 <17.0'],
        'dependencies' => ['nuxt' => '^2.15.8'],
    ]))->toBe('16');
});

it('infers node 16 from Nuxt 2 without engines', function () use ($resolver) {
    expect($resolver->resolveFromSources([
        'dependencies' => ['nuxt' => '^2.15.8'],
    ], framework: 'nuxt'))->toBe('16');
});

it('infers node 24 from Astro 7 without engines', function () use ($resolver) {
    expect($resolver->resolveFromSources([
        'dependencies' => ['astro' => '^7.1.6'],
    ], framework: 'astro-ssr'))->toBe('24');
});

it('prefers engines over nvmrc when they disagree', function () use ($resolver) {
    expect($resolver->resolveFromSources(
        ['engines' => ['node' => '>=22.12.0']],
        nvmrc: "22\n",
    ))->toBe('24');
});

it('uses .nvmrc major when no engines are declared', function () use ($resolver) {
    expect($resolver->resolveFromSources(null, nvmrc: 'v18.20.4'))->toBe('18');
});

it('reads NIXPACKS_NODE_VERSION from nixpacks.toml', function () use ($resolver) {
    expect($resolver->resolveFromSources(
        null,
        nixpacksToml: "[variables]\nNIXPACKS_NODE_VERSION = \"20\"\n",
    ))->toBe('20');
});

it('defaults to 22 when nothing is declared', function () use ($resolver) {
    expect($resolver->resolveFromSources(['name' => 'app']))->toBe('22');
});

it('parses yarn engine mismatch logs to node 16', function () use ($resolver) {
    $logs = <<<'LOG'
error @apollo/federation@0.27.0: The engine "node" is incompatible with this module. Expected version ">=12.13.0 <17.0". Got "22.11.0"
error Found incompatible module.
LOG;

    expect($resolver->logsLookLikeEngineMismatch($logs))->toBeTrue()
        ->and($resolver->resolveFromBuildError($logs, '22'))->toBe('16');
});

it('parses Astro unsupported node logs to 24 even when versions are redacted', function () use ($resolver) {
    $logs = <<<'LOG'
Node.js v<REDACTED>.11.0 is not supported by Astro!
Please upgrade Node.js to a supported version: ">=<REDACTED>.12.0"
LOG;

    $lowercased = mb_strtolower($logs);

    expect($resolver->resolveFromBuildError($logs, '22'))->toBe('24')
        ->and($resolver->resolveFromBuildError($lowercased, '22'))->toBe('24');
});

it('does not retry when the current major already satisfies the constraint', function () use ($resolver) {
    expect($resolver->resolveFromBuildError(
        'Please upgrade Node.js to a supported version: ">=18.0.0"',
        '22',
    ))->toBeNull();
});

it('accepts caret and or constraints used by Vite 8', function () use ($resolver) {
    expect($resolver->pickMajorForConstraint('^20.19.0 || >=22.12.0'))->toBe('24')
        ->and($resolver->majorSatisfies('22', '^20.19.0 || >=22.12.0'))->toBeFalse()
        ->and($resolver->majorSatisfies('20', '^20.19.0 || >=22.12.0'))->toBeFalse();
});
