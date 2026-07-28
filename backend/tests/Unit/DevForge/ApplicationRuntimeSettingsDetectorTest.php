<?php

use App\Services\DevForge\Application\ApplicationRuntimeSettingsDetector;

it('detects Astro SSR with node adapter as non-static', function () {
    $detector = app(ApplicationRuntimeSettingsDetector::class);

    $result = $detector->inferFromContents([
        'package.json' => json_encode([
            'scripts' => [
                'build' => 'astro build',
                'start' => 'node ./dist/server/entry.mjs',
            ],
            'dependencies' => [
                'astro' => '^5.0.0',
                '@astrojs/node' => '^9.0.0',
            ],
        ], JSON_THROW_ON_ERROR),
        'astro.config.mjs' => "export default { output: 'server', adapter: node() };",
        '.env.example' => "PORT=4321\n",
    ]);

    expect($result['available'])->toBeTrue()
        ->and($result['suggestions']['is_static'])->toBeFalse()
        ->and($result['suggestions']['ports_exposes'])->toBe('4321')
        ->and($result['suggestions']['publish_directory'])->toBe('/')
        ->and($result['suggestions']['start_command'])->toBe('node ./dist/server/entry.mjs');
});

it('detects Astro static output as nginx static site', function () {
    $detector = app(ApplicationRuntimeSettingsDetector::class);

    $result = $detector->inferFromContents([
        'package.json' => json_encode([
            'scripts' => ['build' => 'astro build'],
            'dependencies' => ['astro' => '^5.0.0'],
        ], JSON_THROW_ON_ERROR),
        'astro.config.mjs' => "export default { output: 'static' };",
    ]);

    expect($result['available'])->toBeTrue()
        ->and($result['suggestions']['is_static'])->toBeTrue()
        ->and($result['suggestions']['ports_exposes'])->toBe('80')
        ->and($result['suggestions']['publish_directory'])->toBe('/dist')
        ->and($result['suggestions']['start_command'])->toBeNull();
});

it('detects Next.js as node runtime', function () {
    $detector = app(ApplicationRuntimeSettingsDetector::class);

    $result = $detector->inferFromContents([
        'package.json' => json_encode([
            'scripts' => [
                'build' => 'next build',
                'start' => 'next start',
            ],
            'dependencies' => ['next' => '15.0.0'],
        ], JSON_THROW_ON_ERROR),
    ]);

    expect($result['available'])->toBeTrue()
        ->and($result['suggestions']['is_static'])->toBeFalse()
        ->and($result['suggestions']['ports_exposes'])->toBe('3000')
        ->and($result['suggestions']['start_command'])->toBe('next start');
});
