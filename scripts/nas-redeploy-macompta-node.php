<?php

$basePath = '/var/www/html';
require $basePath.'/vendor/autoload.php';
$app = require $basePath.'/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Models\Application;
use App\Models\ApplicationDeploymentQueue;
use Visus\Cuid2\Cuid2;

$a = Application::query()->with('settings')->where('uuid', 'wyo3a2eut7kknr0tii0uvfur')->firstOrFail();

$a->forceFill([
    'ports_exposes' => '80',
    'publish_directory' => '/',
    'start_command' => 'npm run start',
    'build_command' => 'npm run build',
    'install_command' => 'npm ci',
    'static_image' => 'nginx:alpine',
])->save();

if ($a->settings) {
    $a->settings->forceFill([
        'is_static' => false,
        'is_auto_deploy_enabled' => true,
    ])->save();
}

$a->refresh()->load('settings');

echo json_encode([
    'before_deploy' => [
        'start_command' => $a->start_command,
        'build_command' => $a->build_command,
        'install_command' => $a->install_command,
        'ports_exposes' => $a->ports_exposes,
        'publish_directory' => $a->publish_directory,
        'is_static' => (bool) ($a->settings?->is_static),
        'build_pack' => $a->build_pack,
    ],
], JSON_PRETTY_PRINT)."\n";

// Cancel stuck/queued duplicates
ApplicationDeploymentQueue::query()
    ->where('application_id', $a->id)
    ->whereIn('status', ['queued', 'in_progress'])
    ->update(['status' => 'cancelled-by-user']);

$deploymentUuid = (string) new Cuid2;
$result = queue_application_deployment(
    application: $a->fresh(['settings']),
    deployment_uuid: $deploymentUuid,
    force_rebuild: true,
    restart_only: false,
    is_api: true,
    no_questions_asked: true,
);

echo json_encode([
    'deployment_uuid' => $deploymentUuid,
    'result' => $result,
], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)."\n";
