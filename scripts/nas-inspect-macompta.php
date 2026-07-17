<?php

$basePath = '/var/www/html';
require $basePath.'/vendor/autoload.php';
$app = require $basePath.'/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Models\Application;
use App\Models\ApplicationDeploymentQueue;
use App\Models\EnvironmentVariable;

$a = Application::query()
    ->with(['destination.server', 'settings'])
    ->where('uuid', 'wyo3a2eut7kknr0tii0uvfur')
    ->firstOrFail();

$latest = ApplicationDeploymentQueue::query()
    ->where('application_id', $a->id)
    ->latest('id')
    ->first();

$envs = EnvironmentVariable::query()
    ->where('resourceable_type', Application::class)
    ->where('resourceable_id', $a->id)
    ->where('is_preview', false)
    ->orderBy('key')
    ->get(['key', 'is_runtime', 'is_buildtime', 'comment'])
    ->map(fn ($v) => [
        'key' => $v->key,
        'runtime' => (bool) $v->is_runtime,
        'buildtime' => (bool) $v->is_buildtime,
        'comment' => $v->comment,
    ])
    ->all();

$server = $a->destination->server;
$name = trim((string) instant_remote_process(
    ["docker ps --filter name={$a->uuid} --format '{{.Names}}'"],
    $server,
    false,
    no_sudo: true,
));

$files = '';
$nginxConf = '';
if ($name !== '') {
    $files = trim((string) instant_remote_process(
        ["docker exec {$name} sh -c 'ls -la /usr/share/nginx/html 2>/dev/null | head -40; echo ---; ls -la /app 2>/dev/null | head -20; echo ---; cat /etc/nginx/conf.d/default.conf 2>/dev/null | head -80'"],
        $server,
        false,
        no_sudo: true,
    ));
}

$logsSnippet = '';
if ($latest) {
    try {
        $decoded = decode_remote_command_output($latest);
        $logsSnippet = $decoded
            ->filter(fn ($line) => str_contains(strtolower((string) data_get($line, 'line', '')), 'nixpacks')
                || str_contains(strtolower((string) data_get($line, 'line', '')), 'nginx')
                || str_contains(strtolower((string) data_get($line, 'line', '')), 'static')
                || str_contains(strtolower((string) data_get($line, 'line', '')), 'start')
                || str_contains(strtolower((string) data_get($line, 'line', '')), 'error')
                || str_contains(strtolower((string) data_get($line, 'line', '')), 'astro')
                || str_contains(strtolower((string) data_get($line, 'line', '')), 'node'))
            ->take(40)
            ->map(fn ($line) => data_get($line, 'line'))
            ->values()
            ->all();
    } catch (Throwable $e) {
        $logsSnippet = ['error' => $e->getMessage()];
    }
}

echo json_encode([
    'name' => $a->name,
    'uuid' => $a->uuid,
    'fqdn' => $a->fqdn,
    'git_repository' => $a->git_repository,
    'git_branch' => $a->git_branch,
    'build_pack' => $a->build_pack,
    'ports_exposes' => $a->ports_exposes,
    'base_directory' => $a->base_directory,
    'publish_directory' => $a->publish_directory,
    'install_command' => $a->install_command,
    'build_command' => $a->build_command,
    'start_command' => $a->start_command,
    'static_image' => $a->static_image,
    'is_static' => (bool) $a->is_static,
    'dockerfile' => $a->dockerfile,
    'docker_compose_location' => $a->docker_compose_location,
    'container' => $name,
    'container_files' => $files,
    'env_keys' => $envs,
    'latest_deployment' => $latest ? [
        'uuid' => $latest->deployment_uuid,
        'status' => $latest->status,
        'commit' => $latest->commit,
        'message' => $latest->commit_message,
    ] : null,
    'deploy_log_hits' => $logsSnippet,
], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)."\n";
