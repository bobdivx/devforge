<?php

$basePath = '/var/www/html';
require $basePath.'/vendor/autoload.php';
$app = require $basePath.'/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Models\StandaloneLibsql;

$db = StandaloneLibsql::query()->where('uuid', 'btnfrll4ubmua4nvk73y4h6u')->firstOrFail();
$server = $db->destination->server;

$ps = trim((string) instant_remote_process(
    ["docker inspect --format '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' {$db->uuid}"],
    $server,
    false,
    no_sudo: true,
));

[$state, $health] = array_pad(explode('|', $ps, 2), 2, 'none');

if ($state === 'running') {
    $newStatus = $health === 'unhealthy' ? 'running:unhealthy' : 'running:healthy';
} elseif ($state === '') {
    $newStatus = 'exited:unhealthy';
} else {
    $newStatus = $state.':'.($health === 'healthy' ? 'healthy' : 'unhealthy');
}

$db->status = $newStatus;
$db->save();

echo "docker={$ps}\n";
echo "model_status={$db->status}\n";
echo 'is_running='.($db->isRunning() ? 'yes' : 'no')."\n";
