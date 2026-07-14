<?php

$basePath = is_dir('/var/www/html/vendor') ? '/var/www/html' : dirname(__DIR__);

require $basePath.'/vendor/autoload.php';
$app = require $basePath.'/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Models\AiAgent;
use App\Models\AiAgentRun;
use App\Models\Team;
use App\Services\DevForge\Agent\AgentToolkit;
use App\Services\DevForge\Agent\Tool\AgentToolPackage;

echo "=== AGENTS ===\n";
foreach (AiAgent::query()->select('id', 'uuid', 'name', 'type', 'status')->get() as $agent) {
    echo "{$agent->uuid}|{$agent->name}|{$agent->type}|{$agent->status}\n";
}

$agent = AiAgent::query()->with('team')->first();
if (! $agent) {
    echo "NO_AGENT\n";
    exit(0);
}

$run = AiAgentRun::query()->create([
    'agent_id' => $agent->id,
    'status' => 'running',
    'trigger' => 'manual',
]);

$toolkit = new AgentToolkit(
    team: $agent->team,
    run: $run,
    catalog: app(\App\Services\DevForge\Core\CoreResourceCatalog::class),
    resourceAction: app(\App\Services\DevForge\Core\CoreResourceAction::class),
    deploymentData: app(\App\Services\DevForge\DeploymentData::class),
    agent: $agent,
);

$names = collect($toolkit->definitions())->pluck('name')->all();
echo "\n=== TOOLS ({$agent->name}) ===\n";
echo implode(', ', $names)."\n";

$enable = $toolkit->execute('enable_tool_package', [
    'package' => AgentToolPackage::PACKAGE_GITHUB,
    'reason' => 'Probe NAS',
]);
echo "\n=== ENABLE GITHUB ===\n";
echo json_encode($enable, JSON_UNESCAPED_UNICODE)."\n";

$apps = $toolkit->execute('list_github_apps', []);
echo "\n=== GITHUB APPS ===\n";
echo json_encode($apps, JSON_UNESCAPED_UNICODE)."\n";

if (! empty($apps['apps'][0]['uuid'])) {
    $repos = $toolkit->execute('list_github_repos', [
        'github_app_uuid' => $apps['apps'][0]['uuid'],
    ]);
    echo "\n=== REPOS (first 3) ===\n";
    $sample = array_slice($repos['repositories'] ?? [], 0, 3);
    echo json_encode($sample, JSON_UNESCAPED_UNICODE)."\n";
}

echo "\nDONE\n";
