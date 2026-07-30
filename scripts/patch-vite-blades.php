<?php

$files = [
    '/var/www/html/resources/views/layouts/base.blade.php',
    '/var/www/html/resources/views/layouts/devforge-auth.blade.php',
];

$from = "@vite(['resources/js/app.js', 'resources/css/app.css'])";
$to = "@vite(['backend/resources/js/app.js', 'backend/resources/css/app.css'])";

foreach ($files as $file) {
    if (! is_file($file)) {
        echo "missing: {$file}\n";
        continue;
    }

    $contents = file_get_contents($file);
    if (str_contains($contents, $to)) {
        echo "already patched: {$file}\n";
        continue;
    }

    if (! str_contains($contents, $from)) {
        echo "WARN pattern missing: {$file}\n";
        continue;
    }

    file_put_contents($file, str_replace($from, $to, $contents));
    echo "patched: {$file}\n";
}
