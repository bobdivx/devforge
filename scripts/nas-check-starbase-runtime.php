<?php

$basePath = '/var/www/html';
require $basePath.'/vendor/autoload.php';
$app = require $basePath.'/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Models\Application;
use App\Models\ApplicationDeploymentQueue;

$uuids = array_slice($argv, 1);
if ($uuids === []) {
    $uuids = ['julfme7qvjx8tzzypz6qzea0', 'wyo3a2eut7kknr0tii0uvfur'];
}

foreach ($uuids as $uuid) {
    $application = Application::query()
        ->with(['destination.server', 'settings'])
        ->where('uuid', $uuid)
        ->orWhere('uuid', 'like', '%'.$uuid.'%')
        ->orWhere('name', 'like', '%'.$uuid.'%')
        ->first();

    if (! $application) {
        $application = Application::query()->where('name', 'like', '%starbase%')->first();
    }

    if (! $application) {
        echo json_encode(['error' => 'not_found', 'needle' => $uuid], JSON_PRETTY_PRINT)."\n";
        continue;
    }

    $server = $application->destination?->server;
    $container = '';
    $inspect = '';
    $http = '';
    $image = '';

    if ($server) {
        $container = trim((string) instant_remote_process(
            ["docker ps --filter name={$application->uuid} --format '{{.Names}}|{{.Image}}|{{.Status}}'"],
            $server,
            false,
            no_sudo: true,
        ));
        $name = explode('|', $container)[0] ?? '';
        if ($name !== '') {
            $inspect = trim((string) instant_remote_process(
                ["docker inspect --format '{{.Config.Image}}|{{.Config.Cmd}}|{{json .Config.Entrypoint}}|{{.Config.WorkingDir}}' {$name}"],
                $server,
                false,
                no_sudo: true,
            ));
            $http = trim((string) instant_remote_process(
                ["docker exec {$name} sh -c 'wget -qO- --timeout=3 http://127.0.0.1:80/ 2>/dev/null | head -c 300; echo; wget -qO- --timeout=3 http://127.0.0.1:3000/ 2>/dev/null | head -c 300; echo; printenv PORT; printenv HOST; ls /usr/sbin/nginx /app/dist 2>/dev/null | head'"],
                $server,
                false,
                no_sudo: true,
            ));
            $image = trim((string) instant_remote_process(
                ["docker inspect --format '{{.Config.Image}}' {$name}"],
                $server,
                false,
                no_sudo: true,
            ));
        }
    }

    $latest = ApplicationDeploymentQueue::query()
        ->where('application_id', $application->id)
        ->latest('id')
        ->first(['deployment_uuid', 'status', 'commit', 'commit_message', 'created_at', 'finished_at']);

    echo json_encode([
        'uuid' => $application->uuid,
        'name' => $application->name,
        'fqdn' => $application->fqdn,
        'status' => $application->status,
        'build_pack' => $application->build_pack,
        'ports_exposes' => $application->ports_exposes,
        'base_directory' => $application->base_directory,
        'publish_directory' => $application->publish_directory,
        'dockerfile_location' => $application->dockerfile_location,
        'docker_compose_location' => $application->docker_compose_location,
        'docker_registry_image_name' => $application->docker_registry_image_name,
        'container' => $container,
        'inspect' => $inspect,
        'image' => $image,
        'http_probe' => $http,
        'latest_deployment' => $latest ? [
            'uuid' => $latest->deployment_uuid,
            'status' => $latest->status,
            'commit' => $latest->commit,
            'message' => $latest->commit_message,
            'created_at' => (string) $latest->created_at,
        ] : null,
    ], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)."\n---\n";
}
