<?php

$basePath = '/var/www/html';
require $basePath.'/vendor/autoload.php';
$app = require $basePath.'/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Models\Application;
use App\Models\Team;
use App\Services\DevForge\DeploymentData;

$uuid = $argv[1] ?? 'wyo3a2eut7kknr0tii0uvfur';

try {
    $application = Application::query()->where('uuid', $uuid)->first();
    echo 'app='.($application?->name ?? 'null').' id='.($application?->id ?? 'null').PHP_EOL;

    $teamId = $application?->environment?->project?->team_id;
    $team = $teamId ? Team::query()->find($teamId) : Team::query()->first();
    echo 'team='.($team?->id ?? 'null').PHP_EOL;

    $data = app(DeploymentData::class);
    $page = $data->paginate($team, 1, 8, $uuid, null);
    echo 'total='.$page->total().PHP_EOL;
    foreach ($page->items() as $item) {
        echo ($item->deployment_uuid ?? '?').' '.$item->status.PHP_EOL;
    }
    echo "OK\n";
} catch (Throwable $e) {
    echo 'ERROR: '.$e::class.' '.$e->getMessage().PHP_EOL;
    echo $e->getFile().':'.$e->getLine().PHP_EOL;
    echo $e->getTraceAsString().PHP_EOL;
}
