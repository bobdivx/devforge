<?php

$basePath = '/var/www/html';
require $basePath.'/vendor/autoload.php';
$app = require $basePath.'/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Models\Application;
use App\Models\ApplicationDeploymentQueue;

$application = Application::query()
    ->with(['environment.project', 'destination.server'])
    ->where('uuid', 'julfme7qvjx8tzzypz6qzea0')
    ->orWhere('name', 'like', '%starbase%')
    ->first();

if (! $application) {
    echo json_encode(['error' => 'not_found'], JSON_PRETTY_PRINT)."\n";
    exit(1);
}

$deploys = ApplicationDeploymentQueue::query()
    ->where('application_id', $application->id)
    ->latest('id')
    ->limit(8)
    ->get(['deployment_uuid', 'status', 'commit', 'commit_message', 'created_at', 'finished_at', 'force_rebuild']);

echo json_encode([
    'app' => [
        'uuid' => $application->uuid,
        'name' => $application->name,
        'git_repository' => $application->git_repository,
        'git_branch' => $application->git_branch,
        'git_commit_sha' => $application->git_commit_sha ?? null,
        'source_id' => $application->source_id ?? null,
        'fqdn' => $application->fqdn,
        'status' => $application->status,
    ],
    'deployments' => $deploys->map(fn ($d) => [
        'uuid' => $d->deployment_uuid,
        'status' => $d->status,
        'commit' => $d->commit,
        'message' => $d->commit_message,
        'created_at' => (string) $d->created_at,
        'finished_at' => (string) ($d->finished_at ?? ''),
        'force_rebuild' => (bool) $d->force_rebuild,
    ])->all(),
], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)."\n";
