<?php

$basePath = '/var/www/html';
require $basePath.'/vendor/autoload.php';
$app = require $basePath.'/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Models\ApplicationDeploymentQueue;
use App\Models\StandaloneLibsql;
use App\Models\Application;

$dbUuid = 'btnfrll4ubmua4nvk73y4h6u';
$appUuid = 'julfme7qvjx8tzzypz6qzea0';
$deployUuid = $argv[1] ?? 'o54lnys83i1j2zfpyztjahvm';

$database = StandaloneLibsql::query()->with('destination.server')->where('uuid', $dbUuid)->firstOrFail();
$application = Application::query()->where('uuid', $appUuid)->firstOrFail();
$server = $database->destination->server;

for ($i = 1; $i <= 24; $i++) {
    $ps = trim((string) instant_remote_process(
        ["docker ps -a --filter name={$dbUuid} --format '{{.Names}}|{{.Status}}'"],
        $server,
        false,
        no_sudo: true,
    ));

    $database->refresh();
    $deploy = ApplicationDeploymentQueue::query()
        ->where('deployment_uuid', $deployUuid)
        ->first(['status', 'finished_at']);

    echo "t={$i} db_ps=".($ps !== '' ? $ps : 'NONE')
        .' model_status='.$database->status
        .' running='.($database->isRunning() ? 'yes' : 'no')
        .' deploy='.($deploy?->status ?? 'missing')
        .PHP_EOL;

    if (str_contains($ps, 'Up') && in_array($deploy?->status, ['finished', 'failed'], true)) {
        break;
    }

    sleep(5);
}

$psAll = trim((string) instant_remote_process(
    ["docker ps -a --format '{{.Names}} {{.Status}}' | grep -E 'btnfr|{$appUuid}|{$deployUuid}' || true"],
    $server,
    false,
    no_sudo: true,
));
echo "final_containers=\n{$psAll}\n";

// recent activity for start
$activity = \DB::table('activity_log')
    ->where('description', 'like', '%'.$dbUuid.'%')
    ->orWhere('properties', 'like', '%'.$dbUuid.'%')
    ->orderByDesc('id')
    ->limit(3)
    ->get(['id', 'description', 'created_at']);

echo 'recent_activity='.json_encode($activity, JSON_UNESCAPED_UNICODE).PHP_EOL;
