<?php

$basePath = '/var/www/html';
require $basePath.'/vendor/autoload.php';
$app = require $basePath.'/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Models\Application;
use App\Models\EnvironmentVariable;

$uuid = $argv[1] ?? 'julfme7qvjx8tzzypz6qzea0';
$application = Application::where('uuid', $uuid)->firstOrFail();

$existing = $application->environment_variables()
    ->where('key', 'PUPPETEER_SKIP_DOWNLOAD')
    ->first();

if ($existing) {
    $existing->update([
        'value' => 'true',
        'is_buildtime' => true,
        'is_runtime' => true,
    ]);
    echo "UPDATED PUPPETEER_SKIP_DOWNLOAD on {$application->name}\n";
} else {
    EnvironmentVariable::create([
        'key' => 'PUPPETEER_SKIP_DOWNLOAD',
        'value' => 'true',
        'is_buildtime' => true,
        'is_runtime' => true,
        'is_preview' => false,
        'is_multiline' => false,
        'is_literal' => true,
        'resourceable_type' => Application::class,
        'resourceable_id' => $application->id,
    ]);
    echo "CREATED PUPPETEER_SKIP_DOWNLOAD on {$application->name}\n";
}
