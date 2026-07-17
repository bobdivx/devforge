<?php

$basePath = '/var/www/html';
require $basePath.'/vendor/autoload.php';
$app = require $basePath.'/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Models\ApplicationDeploymentQueue;
use App\Services\DevForge\Agent\DeploymentAgentDispatchLimiter;
use App\Services\DevForge\Agent\DeploymentAgentResolver;
use App\Services\DevForge\Agent\DeploymentFailureAgentDispatcher;
use App\Services\DevForge\DeploymentData;

$uuid = $argv[1] ?? 'u4ozoq91kdlgs3i5h0gs90hm';

function step(string $label): void
{
    echo '['.date('H:i:s')."] {$label}\n";
    @ob_flush();
    flush();
}

step('boot');
$deployment = ApplicationDeploymentQueue::query()->with('application')->where('deployment_uuid', $uuid)->first();
step('deployment='.($deployment?->status ?? 'null'));
$application = $deployment?->application;
step('app='.($application?->uuid ?? 'null'));

$resolver = app(DeploymentAgentResolver::class);
$team = $resolver->resolveTeam($application);
step('team='.($team?->id ?? 'null'));

$limiter = app(DeploymentAgentDispatchLimiter::class);
$count = $limiter->countRunsForDeployment($team, $uuid);
step("count_runs={$count} allows=".($limiter->allows('deployment_failed', $team, $uuid) ? 'yes' : 'no'));

$agent = $resolver->resolve($team, $application->uuid, DeploymentAgentResolver::FAILURE_TYPES);
step('agent='.($agent?->uuid ?? 'null').' status='.($agent?->status ?? 'null'));

step('extracting logs excerpt');
$payload = app(DeploymentData::class)->logs($deployment, 0);
step('log_items='.count($payload['items'] ?? []));

step('full dispatch');
$run = app(DeploymentFailureAgentDispatcher::class)->dispatch($application, $uuid, $deployment);
step('result='.($run ? $run->uuid.'|'.$run->status : 'null'));
