<?php

$basePath = '/var/www/html';
require $basePath.'/vendor/autoload.php';
$app = require $basePath.'/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Models\AiAgentRun;
use Illuminate\Support\Facades\Redis;

$uuid = $argv[1] ?? '019f6c28-7b38-73b8-9e53-310b473f0f43';

$run = AiAgentRun::query()->where('uuid', $uuid)->first();
if (! $run) {
    echo "RUN_NOT_FOUND\n";
    exit(1);
}

echo "status={$run->status}\n";
echo "iterations={$run->iterations}\n";
echo 'summary='.mb_substr((string) $run->summary, 0, 300)."\n";
echo 'agent_status='.$run->agent?->status."\n";
echo 'default_queue='.Redis::llen('queues:default')."\n";
echo 'horizon_status=';
passthru('php artisan horizon:status');
echo "\n--- logs ---\n";
echo (string) $run->logs."\n";
