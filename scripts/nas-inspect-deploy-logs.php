<?php

$basePath = '/var/www/html';
require $basePath.'/vendor/autoload.php';
$app = require $basePath.'/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Models\ApplicationDeploymentQueue;
use App\Services\DevForge\DeploymentData;

$uuid = $argv[1] ?? 'u4ozoq91kdlgs3i5h0gs90hm';
$d = ApplicationDeploymentQueue::where('deployment_uuid', $uuid)->first();
$raw = $d->logs;
$decoded = is_string($raw) ? json_decode($raw, true) : $raw;

echo 'raw_type='.gettype($raw)."\n";
echo 'decoded_count='.(is_array($decoded) ? count($decoded) : 0)."\n";

if (is_array($decoded) && isset($decoded[0])) {
    echo 'first_keys='.implode(',', array_keys($decoded[0]))."\n";
    echo 'first_sample='.substr(json_encode($decoded[0]), 0, 400)."\n";
    $withLine = collect($decoded)->filter(fn ($l) => is_array($l) && filled($l['line'] ?? null))->count();
    $withMsg = collect($decoded)->filter(fn ($l) => is_array($l) && filled($l['message'] ?? null))->count();
    echo "filled_line={$withLine} filled_message={$withMsg}\n";
}

$payload = app(DeploymentData::class)->logs($d, 0);
$items = collect($payload['items'] ?? []);
echo 'deploymentData_count='.$items->count()."\n";
$nonEmpty = $items->filter(fn ($l) => filled($l['message'] ?? null));
echo 'deploymentData_nonempty='.$nonEmpty->count()."\n";
echo 'last_nonempty='.substr((string) $nonEmpty->last()['message'] ?? '', 0, 200)."\n";

$failed = \Illuminate\Support\Facades\DB::table('failed_jobs')->latest('failed_at')->limit(3)->get(['id', 'payload', 'exception', 'failed_at']);
foreach ($failed as $job) {
    $payload = json_decode($job->payload, true);
    $display = $payload['displayName'] ?? '?';
    echo "failed_job={$job->id}|{$display}|{$job->failed_at}|".substr($job->exception, 0, 120)."\n";
}

$run = \App\Models\AiAgentRun::where('uuid', '019f6c28-7b38-73b8-9e53-310b473f0f43')->first();
echo 'run_status='.$run?->status.' iter='.$run?->iterations."\n";
