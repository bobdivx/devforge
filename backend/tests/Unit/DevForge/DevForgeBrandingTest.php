<?php

it('does not expose Coolify branding in the DevForge frontend', function () {
    $root = dirname(base_path()).DIRECTORY_SEPARATOR.'frontend'.DIRECTORY_SEPARATOR.'src';
    $hits = [];

    $iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root));
    foreach ($iterator as $file) {
        if (! $file->isFile() || ! in_array($file->getExtension(), ['tsx', 'ts', 'astro'], true)) {
            continue;
        }

        if (preg_match('/\bCoolify\b/', (string) file_get_contents($file->getPathname())) === 1) {
            $hits[] = str_replace($root.DIRECTORY_SEPARATOR, '', $file->getPathname());
        }
    }

    expect($hits)->toBeEmpty();
});

it('does not expose Coolify branding in Blade views', function () {
    $root = dirname(base_path()).DIRECTORY_SEPARATOR.'backend'.DIRECTORY_SEPARATOR.'resources'.DIRECTORY_SEPARATOR.'views';
    $hits = [];

    $iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root));
    foreach ($iterator as $file) {
        if (! $file->isFile() || $file->getExtension() !== 'php') {
            continue;
        }

        $contents = (string) file_get_contents($file->getPathname());
        $contents = preg_replace('/CoolifyTask/', '', $contents) ?? $contents;

        if (preg_match('/\bCoolify\b/', $contents) === 1) {
            $hits[] = str_replace($root.DIRECTORY_SEPARATOR, '', $file->getPathname());
        }
    }

    expect($hits)->toBeEmpty();
});

it('does not expose Coolify branding in application PHP', function () {
    $root = dirname(base_path()).DIRECTORY_SEPARATOR.'backend'.DIRECTORY_SEPARATOR.'app';
    $hits = [];

    $iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root));
    foreach ($iterator as $file) {
        if (! $file->isFile() || $file->getExtension() !== 'php') {
            continue;
        }

        $contents = (string) file_get_contents($file->getPathname());
        $contents = preg_replace('/CoolifyTask|CoolifyServer|UpdateCoolify|isCoolify|validateCoolify|fixCoolify|detectLegacyCoolify|fromCoolify|migrateFromCoolify|restoreCoolify|cleanupUnusedNetworkFromCoolify/', '', $contents) ?? $contents;

        if (preg_match('/\bCoolify\b/', $contents) === 1) {
            $hits[] = str_replace($root.DIRECTORY_SEPARATOR, '', $file->getPathname());
        }
    }

    expect($hits)->toBeEmpty();
});

it('seeds the localhost server without Coolify wording', function () {
    $seeder = dirname(base_path()).DIRECTORY_SEPARATOR.'backend'.DIRECTORY_SEPARATOR.'database'.DIRECTORY_SEPARATOR.'seeders'.DIRECTORY_SEPARATOR.'ProductionSeeder.php';

    expect(is_file($seeder))->toBeTrue()
        ->and(file_get_contents($seeder))->not->toContain('Coolify')
        ->and(file_get_contents($seeder))->not->toContain('coolify.io')
        ->and(file_get_contents($seeder))->toContain('DevForge is running on')
        ->and(file_get_contents($seeder))->toContain("'network' => 'devforge'");
});

it('does not expose coolify.io in user-facing surfaces', function () {
    $roots = [
        dirname(base_path()).DIRECTORY_SEPARATOR.'backend'.DIRECTORY_SEPARATOR.'resources'.DIRECTORY_SEPARATOR.'views',
        dirname(base_path()).DIRECTORY_SEPARATOR.'frontend'.DIRECTORY_SEPARATOR.'src',
        dirname(base_path()).DIRECTORY_SEPARATOR.'backend'.DIRECTORY_SEPARATOR.'app'.DIRECTORY_SEPARATOR.'Livewire',
        dirname(base_path()).DIRECTORY_SEPARATOR.'backend'.DIRECTORY_SEPARATOR.'app'.DIRECTORY_SEPARATOR.'Notifications',
        dirname(base_path()).DIRECTORY_SEPARATOR.'backend'.DIRECTORY_SEPARATOR.'database'.DIRECTORY_SEPARATOR.'seeders',
    ];

    $hits = [];
    foreach ($roots as $root) {
        if (! is_dir($root)) {
            continue;
        }

        $iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root));
        foreach ($iterator as $file) {
            if (! $file->isFile() || ! in_array($file->getExtension(), ['php', 'tsx', 'ts', 'astro', 'json'], true)) {
                continue;
            }

            $contents = (string) file_get_contents($file->getPathname());
            if (str_contains($contents, 'coolify.io') || str_contains($contents, '/docs/knowledge-base') || str_contains($contents, 'devforge/docs/')) {
                $hits[] = $file->getPathname();
            }
        }
    }

    expect($hits)->toBeEmpty();
});
