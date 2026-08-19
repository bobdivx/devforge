<?php

use App\Services\DevForge\Application\ApplicationRuntimeSettingsDetector;

it('detects Astro SSR with node adapter as non-static with Coolify defaults', function () {
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
        'package-lock.json' => '{}',
        '.env.example' => "PORT=4321\n",
    ]);

    expect($result['available'])->toBeTrue()
        ->and($result['suggestions']['is_static'])->toBeFalse()
        ->and($result['suggestions']['ports_exposes'])->toBe('4321')
        ->and($result['suggestions']['publish_directory'])->toBe('/dist')
        ->and($result['suggestions']['start_command'])->toBe('node ./dist/server/entry.mjs')
        ->and($result['suggestions']['build_command'])->toBe('astro build')
        ->and($result['suggestions']['install_command'])->toBe('npm ci')
        ->and($result['suggestions']['health_check_enabled'])->toBeTrue()
        ->and($result['suggestions']['health_check_path'])->toBe('/')
        ->and($result['suggestions']['health_check_port'])->toBe('4321')
        ->and($result['suggestions']['framework'])->toBe('astro-ssr')
        ->and($result['suggestions']['framework_label'])->toBe('Astro SSR');
});

it('detects Astro SSR from @astrojs/node alone without readable config', function () {
    $detector = app(ApplicationRuntimeSettingsDetector::class);

    $result = $detector->inferFromContents([
        'package.json' => json_encode([
            'scripts' => ['build' => 'astro build'],
            'dependencies' => [
                'astro' => '^5.0.0',
                '@astrojs/node' => '^9.0.0',
            ],
        ], JSON_THROW_ON_ERROR),
    ]);

    expect($result['suggestions']['is_static'])->toBeFalse()
        ->and($result['suggestions']['ports_exposes'])->toBe('4321')
        ->and($result['suggestions']['start_command'])->toBe('node ./dist/server/entry.mjs')
        ->and($result['suggestions']['publish_directory'])->toBe('/dist')
        ->and($result['suggestions']['framework'])->toBe('astro-ssr');
});

it('detects Astro SSR from entry.mjs start script even without adapter dep listed', function () {
    $detector = app(ApplicationRuntimeSettingsDetector::class);

    $result = $detector->inferFromContents([
        'package.json' => json_encode([
            'scripts' => [
                'build' => 'astro build',
                'start' => 'node ./dist/server/entry.mjs',
            ],
            'dependencies' => ['astro' => '^5.0.0'],
        ], JSON_THROW_ON_ERROR),
        'astro.config.mjs' => "import node from '@astrojs/node';\nexport default { output: 'server', adapter: node({ mode: 'standalone' }) };",
    ]);

    expect($result['suggestions']['is_static'])->toBeFalse()
        ->and($result['suggestions']['start_command'])->toBe('node ./dist/server/entry.mjs')
        ->and($result['suggestions']['framework'])->toBe('astro-ssr');
});

it('detects Astro from astro.config alone as static when no SSR signals', function () {
    $detector = app(ApplicationRuntimeSettingsDetector::class);

    $result = $detector->inferFromContents([
        'astro.config.mjs' => "export default { output: 'static' };",
    ]);

    expect($result['available'])->toBeTrue()
        ->and($result['suggestions']['is_static'])->toBeTrue()
        ->and($result['suggestions']['ports_exposes'])->toBe('80')
        ->and($result['suggestions']['publish_directory'])->toBe('/dist')
        ->and($result['suggestions']['build_command'])->toBe('astro build')
        ->and($result['suggestions']['framework'])->toBe('astro-static');
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
        ->and($result['suggestions']['start_command'])->toBeNull()
        ->and($result['suggestions']['framework'])->toBe('astro-static')
        ->and($result['suggestions']['framework_label'])->toBe('Astro static');
});

it('prefers SSR when output static conflicts with node adapter', function () {
    $detector = app(ApplicationRuntimeSettingsDetector::class);

    $result = $detector->inferFromContents([
        'package.json' => json_encode([
            'scripts' => ['build' => 'astro build'],
            'dependencies' => [
                'astro' => '^5.0.0',
                '@astrojs/node' => '^9.0.0',
            ],
        ], JSON_THROW_ON_ERROR),
        'astro.config.mjs' => "export default { output: 'static' };",
    ]);

    expect($result['suggestions']['is_static'])->toBeFalse()
        ->and($result['suggestions']['framework'])->toBe('astro-ssr')
        ->and($result['suggestions']['ports_exposes'])->toBe('4321');
});

it('treats leftover @astrojs/vercel as static when output is static and no node adapter is used', function () {
    $detector = app(ApplicationRuntimeSettingsDetector::class);

    $result = $detector->inferFromContents([
        'package.json' => json_encode([
            'scripts' => [
                'build' => 'node scripts/popcorn-cli.js build',
                'preview' => 'node scripts/popcorn-cli.js preview',
            ],
            'dependencies' => [
                'astro' => '^7.1.6',
                '@astrojs/preact' => '^6.0.2',
            ],
            'devDependencies' => [
                '@astrojs/vercel' => '^11.0.4',
            ],
        ], JSON_THROW_ON_ERROR),
        'astro.config.mjs' => "import preact from '@astrojs/preact';\nexport default { output: 'static', integrations: [preact()] };",
        'package-lock.json' => '{}',
    ]);

    expect($result['suggestions']['is_static'])->toBeTrue()
        ->and($result['suggestions']['start_command'])->toBeNull()
        ->and($result['suggestions']['ports_exposes'])->toBe('80')
        ->and($result['suggestions']['publish_directory'])->toBe('/dist')
        ->and($result['suggestions']['framework'])->toBe('astro-static');
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
        ->and($result['suggestions']['start_command'])->toBe('next start')
        ->and($result['suggestions']['framework'])->toBe('next')
        ->and($result['suggestions']['framework_label'])->toBe('Next.js')
        ->and($result['suggestions']['nixpacks_node_version'])->toBe('22');
});

it('suggests Node 24 for Astro 7 engines and Node 16 for Nuxt 2', function () {
    $detector = app(ApplicationRuntimeSettingsDetector::class);

    $astro = $detector->inferFromContents([
        'package.json' => json_encode([
            'engines' => ['node' => '>=22.12.0'],
            'scripts' => ['build' => 'astro build', 'start' => 'node ./dist/server/entry.mjs'],
            'dependencies' => ['astro' => '^7.1.6', '@astrojs/node' => '^9.0.0'],
        ], JSON_THROW_ON_ERROR),
    ]);

    $nuxt = $detector->inferFromContents([
        'package.json' => json_encode([
            'scripts' => ['dev' => 'nuxt', 'start' => 'nuxt start'],
            'dependencies' => ['nuxt' => '^2.15.8'],
        ], JSON_THROW_ON_ERROR),
        'yarn.lock' => '# yarn',
    ]);

    expect($astro['suggestions']['nixpacks_node_version'])->toBe('24')
        ->and($nuxt['suggestions']['framework'])->toBe('nuxt')
        ->and($nuxt['suggestions']['nixpacks_node_version'])->toBe('16');
});
