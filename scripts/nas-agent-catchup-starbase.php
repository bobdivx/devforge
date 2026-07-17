<?php

$basePath = is_dir('/var/www/html/vendor') ? '/var/www/html' : dirname(__DIR__);

require $basePath.'/vendor/autoload.php';
$app = require $basePath.'/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Models\AiAgentRun;
use App\Models\ApplicationDeploymentQueue;
use App\Services\DevForge\Agent\DeploymentAgentCatchUp;

$deploymentUuid = $argv[1] ?? 'u4ozoq91kdlgs3i5h0gs90hm';

$deployment = ApplicationDeploymentQueue::query()
    ->where('deployment_uuid', $deploymentUuid)
    ->first();

if ($deployment === null) {
    echo "DEPLOY_NOT_FOUND\n";
    exit(1);
}

echo "status={$deployment->status}\n";

$ok = app(DeploymentAgentCatchUp::class)->maybeDispatch($deployment);
echo 'catch_up='.($ok ? 'yes' : 'no')."\n";

$runs = AiAgentRun::query()
    ->where('logs', 'like', '%'.$deploymentUuid.'%')
    ->latest()
    ->limit(5)
    ->get(['uuid', 'status', 'iterations', 'summary', 'created_at']);

foreach ($runs as $run) {
    echo implode('|', [
        $run->uuid,
        $run->status,
        'iter='.$run->iterations,
        mb_substr((string) $run->summary, 0, 100),
        (string) $run->created_at,
    ]).PHP_EOL;
}
