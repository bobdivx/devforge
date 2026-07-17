<?php

$basePath = '/var/www/html';
require $basePath.'/vendor/autoload.php';
$app = require $basePath.'/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Models\AiAgent;
use App\Models\AiAgentRun;
use App\Models\ApplicationDeploymentQueue;
use App\Services\DevForge\Agent\DeploymentFailureAgentDispatcher;

$deploymentUuid = $argv[1] ?? 'u4ozoq91kdlgs3i5h0gs90hm';

$stale = AiAgentRun::query()
    ->whereIn('status', ['pending', 'running'])
    ->where('logs', 'like', '%'.$deploymentUuid.'%')
    ->get();

foreach ($stale as $run) {
    $run->update([
        'status' => 'failed',
        'iterations' => 0,
        'summary' => 'Run interrompu pour relance après correctif agent.',
        'finished_at' => now(),
    ]);
    echo "stale_closed={$run->uuid}\n";
}

// Les runs récemment échoués avec itérations > 0 bloquent wasRecentlyHandled :
// on les marque aussi à 0 itérations pour autoriser une relance de diagnostic.
AiAgentRun::query()
    ->where('trigger', 'event')
    ->where('status', 'failed')
    ->where('created_at', '>=', now()->subHour())
    ->where('logs', 'like', '%'.$deploymentUuid.'%')
    ->where('iterations', '>', 0)
    ->update(['iterations' => 0]);

AiAgent::query()->where('status', 'running')->each(function (AiAgent $agent): void {
    $active = $agent->runs()->whereIn('status', ['pending', 'running'])->exists();
    if (! $active) {
        $agent->update(['status' => 'idle']);
        echo "agent_idle={$agent->uuid}\n";
    }
});

$deployment = ApplicationDeploymentQueue::query()
    ->with('application')
    ->where('deployment_uuid', $deploymentUuid)
    ->firstOrFail();

$run = app(DeploymentFailureAgentDispatcher::class)->dispatch(
    application: $deployment->application,
    deploymentUuid: $deploymentUuid,
    deploymentQueue: $deployment,
);

if ($run === null) {
    echo "DISPATCH_NULL\n";
    exit(2);
}

echo "DISPATCHED={$run->uuid}\n";

for ($i = 0; $i < 48; $i++) {
    sleep(5);
    $run->refresh();
    echo '['.date('H:i:s')."] status={$run->status} iter={$run->iterations} summary=".mb_substr((string) $run->summary, 0, 80)."\n";
    if (! in_array($run->status, ['pending', 'running'], true)) {
        echo "--- logs tail ---\n";
        echo mb_substr((string) $run->logs, -1500)."\n";
        exit($run->status === 'completed' ? 0 : 1);
    }
}

echo "TIMEOUT_WAITING\n";
echo mb_substr((string) $run->logs, -1500)."\n";
exit(3);
