<?php

$basePath = '/var/www/html';
require $basePath.'/vendor/autoload.php';
$app = require $basePath.'/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Models\Application;
use App\Models\ApplicationDeploymentQueue;

$a = Application::query()->with('destination.server')->where('uuid', 'wyo3a2eut7kknr0tii0uvfur')->firstOrFail();
$deadline = time() + 300;

while (time() < $deadline) {
    $latest = ApplicationDeploymentQueue::query()
        ->where('application_id', $a->id)
        ->latest('id')
        ->first();

    $status = $latest?->status ?? 'none';
    echo date('H:i:s')." status={$status} commit=".substr((string) $latest?->commit, 0, 7)."\n";

    if (in_array($status, ['finished', 'failed', 'cancelled-by-user'], true)) {
        $server = $a->destination->server;
        $container = trim((string) instant_remote_process(
            ["docker ps --filter name={$a->uuid} --format '{{.Names}}|{{.Image}}|{{.Status}}'"],
            $server,
            false,
            no_sudo: true,
        ));
        $name = explode('|', $container)[0] ?? '';
        $inspect = '';
        $http = '';
        if ($name !== '') {
            $inspect = trim((string) instant_remote_process(
                ["docker inspect --format '{{.Config.Cmd}}|{{json .Config.Entrypoint}}' {$name}"],
                $server,
                false,
                no_sudo: true,
            ));
            $http = trim((string) instant_remote_process(
                ["docker exec {$name} sh -c 'wget -qO- --timeout=5 http://127.0.0.1:80/ 2>&1 | head -c 250'"],
                $server,
                false,
                no_sudo: true,
            ));
        }

        echo json_encode([
            'deployment_status' => $status,
            'commit' => $latest?->commit,
            'container' => $container,
            'inspect' => $inspect,
            'http' => $http,
            'app_status' => $a->fresh()->status,
        ], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)."\n";
        exit($status === 'finished' ? 0 : 1);
    }

    sleep(8);
}

echo "TIMEOUT\n";
exit(1);
