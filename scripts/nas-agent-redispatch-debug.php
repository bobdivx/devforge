<?php

$basePath = '/var/www/html';
require $basePath.'/vendor/autoload.php';
$app = require $basePath.'/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Models\ApplicationDeploymentQueue;
use App\Services\DevForge\Agent\DeploymentFailureAgentDispatcher;

$uuid = $argv[1] ?? 'u4ozoq91kdlgs3i5h0gs90hm';

function step(string $label): void
{
    echo '['.date('H:i:s')."] {$label}\n";
    flush();
}

step('start');

$deployment = ApplicationDeploymentQueue::query()
    ->with('application')
    ->where('deployment_uuid', $uuid)
    ->first();

step('loaded deployment status='.($deployment?->status ?? 'null'));

if ($deployment === null || $deployment->application === null) {
    echo "DEPLOY_NOT_FOUND\n";
    exit(1);
}

step('calling dispatcher');

$run = app(DeploymentFailureAgentDispatcher::class)->dispatch(
    application: $deployment->application,
    deploymentUuid: $uuid,
    deploymentQueue: $deployment,
);

step('dispatcher returned');

if ($run === null) {
    echo "DISPATCH_NULL\n";
    exit(2);
}

echo "DISPATCHED={$run->uuid}|{$run->status}\n";
