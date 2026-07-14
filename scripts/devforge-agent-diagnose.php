<?php

$root = '/var/www/html';
require $root.'/vendor/autoload.php';
$app = require $root.'/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Models\AiAgent;
use App\Models\AiAgentRun;
use App\Models\AiProviderConfig;
use App\Services\DevForge\Agent\LlmModelResolver;
use App\Services\DevForge\Agent\LlmProviderFactory;

echo "=== Ollama providers ===\n";
foreach (AiProviderConfig::query()->where('provider', 'ollama')->get() as $provider) {
    echo json_encode([
        'id' => $provider->id,
        'name' => $provider->name,
        'model' => $provider->model,
        'base_url' => $provider->base_url,
        'is_default' => $provider->is_default,
    ], JSON_UNESCAPED_SLASHES)."\n";
}

echo "\n=== Build agent ===\n";
$agent = AiAgent::query()->where('type', 'devforge')->orWhere('name', 'like', '%Build%')->first();
if ($agent) {
    echo json_encode([
        'uuid' => $agent->uuid,
        'name' => $agent->name,
        'status' => $agent->status,
        'provider_config_id' => $agent->provider_config_id,
    ], JSON_UNESCAPED_SLASHES)."\n";
}

echo "\n=== Last 3 failed runs ===\n";
foreach (AiAgentRun::query()->where('status', 'failed')->latest()->limit(3)->get() as $run) {
    echo json_encode([
        'uuid' => $run->uuid,
        'summary' => $run->summary,
        'metadata' => $run->metadata,
        'created_at' => optional($run->created_at)->toDateTimeString(),
    ], JSON_UNESCAPED_SLASHES)."\n";
}

if ($agent) {
    echo "\n=== Effective provider ===\n";
    $config = $agent->effectiveProviderConfig();
    if ($config) {
        echo json_encode([
            'id' => $config->id,
            'name' => $config->name,
            'provider' => $config->provider,
            'model' => $config->model,
            'base_url' => $config->base_url,
            'is_auto' => LlmModelResolver::isAuto($config->model),
        ], JSON_UNESCAPED_SLASHES)."\n";
    }
}
