<?php

$basePath = is_dir('/var/www/html/vendor') ? '/var/www/html' : dirname(__DIR__);

require $basePath.'/vendor/autoload.php';
$app = require $basePath.'/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Models\AiAgentRun;
use App\Models\ApplicationDeploymentQueue;
use App\Services\DevForge\Agent\DeploymentFailureAgentDispatcher;

$deploymentUuid = $argv[1] ?? 'u4ozoq91kdlgs3i5h0gs90hm';

$deployment = ApplicationDeploymentQueue::query()
    ->with('application')
    ->where('deployment_uuid', $deploymentUuid)
    ->first();

if ($deployment === null || $deployment->application === null) {
    echo "DEPLOY_NOT_FOUND\n";
    exit(1);
}

$run = app(DeploymentFailureAgentDispatcher::class)->dispatch(
    application: $deployment->application,
    deploymentUuid: $deploymentUuid,
    deploymentQueue: $deployment,
);

if ($run === null) {
    echo "DISPATCH_NULL\n";
    $latest = AiAgentRun::query()
        ->where('logs', 'like', '%'.$deploymentUuid.'%')
        ->latest()
        ->first();
    if ($latest) {
        echo "latest={$latest->uuid}|{$latest->status}|iter={$latest->iterations}|{$latest->summary}\n";
    }
    exit(2);
}

echo "DISPATCHED={$run->uuid}|{$run->status}\n";

sleep(8);

$run->refresh();
echo "AFTER={$run->uuid}|{$run->status}|iter={$run->iterations}|".mb_substr((string) $run->summary, 0, 120)."\n";
echo "logs_tail:\n";
echo mb_substr((string) $run->logs, -800)."\n";
