<?php

/**
 * Découvre les classes App\* référencées par le code DevForge / agents
 * et retourne leurs chemins relatifs (une ligne par fichier).
 *
 * Usage: php scripts/devforge-package-discover.php [root]
 */

declare(strict_types=1);

$root = isset($argv[1]) && $argv[1] !== '' ? rtrim($argv[1], '/\\') : dirname(__DIR__);

$scanRoots = [
    $root.'/app/Services/DevForge',
    $root.'/app/Jobs/Agent',
    $root.'/app/Http/Controllers/DevForge',
    $root.'/app/Jobs/ApplicationDeploymentJob.php',
    $root.'/app/Console/Commands/RunScheduledAgentsCommand.php',
];

$discovered = [];

foreach ($scanRoots as $scanRoot) {
    if (! file_exists($scanRoot)) {
        continue;
    }

    $files = is_file($scanRoot)
        ? [$scanRoot]
        : iterator_to_array(
            new RecursiveIteratorIterator(
                new RecursiveDirectoryIterator($scanRoot, FilesystemIterator::SKIP_DOTS)
            )
        );

    foreach ($files as $file) {
        if (! $file instanceof SplFileInfo || $file->getExtension() !== 'php') {
            continue;
        }

        $content = file_get_contents($file->getPathname());
        if ($content === false) {
            continue;
        }

        if (! preg_match_all('/^use App\\\\([^;]+);/m', $content, $matches)) {
            continue;
        }

        foreach ($matches[1] as $class) {
            $class = trim($class);

            if (str_starts_with($class, 'Services\\DevForge\\')) {
                continue;
            }

            $relative = 'app/'.str_replace('\\', '/', $class).'.php';
            $full = $root.'/'.$relative;

            if (is_file($full)) {
                $discovered[$relative] = true;
            }
        }
    }
}

ksort($discovered);

foreach (array_keys($discovered) as $path) {
    echo $path, PHP_EOL;
}
