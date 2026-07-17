<?php

$basePath = '/var/www/html';
require $basePath.'/vendor/autoload.php';
$app = require $basePath.'/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Models\ApplicationDeploymentQueue;

$uuid = $argv[1] ?? 'p7vla3jftgj9wslutzbu71bd';
$d = ApplicationDeploymentQueue::where('deployment_uuid', $uuid)->first();
if (! $d) {
    echo "NOT_FOUND\n";
    exit(1);
}
echo "status={$d->status}\n";
echo 'finished='.($d->finished_at ?? 'null')."\n";
