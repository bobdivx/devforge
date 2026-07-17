<?php

$basePath = '/var/www/html';
require $basePath.'/vendor/autoload.php';
$app = require $basePath.'/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Models\Application;
use App\Models\ApplicationDeploymentQueue;
use Visus\Cuid2\Cuid2;

$a = Application::query()->where('uuid', 'wyo3a2eut7kknr0tii0uvfur')->firstOrFail();

$a->forceFill([
    'ports_exposes' => '80',
    'publish_directory' => null,
    'start_command' => 'npm run start',
    'build_command' => 'npm run build',
    'install_command' => 'npm ci',
])->save();

if ($a->settings) {
    $a->settings->forceFill(['is_static' => false])->save();
}

// Avoid duplicate queued deploys if webhook already fired for the push.
$recent = ApplicationDeploymentQueue::query()
    ->where('application_id', $a->id)
    ->where('commit', 'like', '470eef8%')
    ->whereIn('status', ['queued', 'in_progress', 'finished'])
    ->latest('id')
    ->first();

if ($recent) {
    echo json_encode([
        'application' => $a->name,
        'uuid' => $a->uuid,
        'ports_exposes' => $a->ports_exposes,
        'start_command' => $a->start_command,
        'existing_deployment' => [
            'uuid' => $recent->deployment_uuid,
            'status' => $recent->status,
            'commit' => $recent->commit,
        ],
    ], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)."\n";
    exit(0);
}

$deploymentUuid = (string) new Cuid2;
$result = queue_application_deployment(
    application: $a->fresh(),
    deployment_uuid: $deploymentUuid,
    force_rebuild: true,
    restart_only: false,
    is_api: true,
    no_questions_asked: true,
);

echo json_encode([
    'application' => $a->name,
    'uuid' => $a->uuid,
    'ports_exposes' => $a->ports_exposes,
    'start_command' => $a->start_command,
    'deployment' => $result,
    'deployment_uuid' => $deploymentUuid,
], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)."\n";
