<?php

$manifestPath = '/var/www/html/public/build/manifest.json';
$manifest = json_decode((string) file_get_contents($manifestPath), true);
$normalized = [];
$changed = 0;

foreach ($manifest as $key => $value) {
    $nextKey = str_starts_with($key, 'backend/') ? substr($key, 8) : $key;

    if (isset($value['src']) && is_string($value['src']) && str_starts_with($value['src'], 'backend/')) {
        $value['src'] = substr($value['src'], 8);
    }

    if ($nextKey !== $key) {
        $changed++;
    }

    $normalized[$nextKey] = $value;
}

file_put_contents(
    $manifestPath,
    json_encode($normalized, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES)."\n",
);
echo "normalized {$changed} keys\n";

$from = "@vite(['backend/resources/js/app.js', 'backend/resources/css/app.css'])";
$to = "@vite(['resources/js/app.js', 'resources/css/app.css'])";

foreach ([
    '/var/www/html/resources/views/layouts/base.blade.php',
    '/var/www/html/resources/views/layouts/devforge-auth.blade.php',
] as $file) {
    $contents = file_get_contents($file);
    if (str_contains($contents, $from)) {
        file_put_contents($file, str_replace($from, $to, $contents));
        echo "reverted {$file}\n";
    } elseif (str_contains($contents, $to)) {
        echo "already standard {$file}\n";
    } else {
        echo "WARN unexpected vite directive: {$file}\n";
    }
}
