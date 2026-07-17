<?php

$basePath = '/var/www/html';
require $basePath.'/vendor/autoload.php';
$app = require $basePath.'/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Enums\TaskModelTier;
use App\Models\AiAgent;
use App\Services\DevForge\Agent\LlmProviderFactory;
use App\Services\DevForge\Agent\OllamaFallbackResolver;

function step(string $label, ?float $start = null): float
{
    $now = microtime(true);
    $delta = $start !== null ? ' +'.round(($now - $start) * 1000).'ms' : '';
    echo '['.date('H:i:s')."]{$delta} {$label}\n";
    @ob_flush();
    flush();

    return $now;
}

$t0 = step('boot');
$agent = AiAgent::query()->where('uuid', '019f618a-559d-70e5-ac9e-7e7cb73be8bb')->first()
    ?? AiAgent::query()->where('type', 'deployment')->where('is_active', true)->first();

step('agent='.($agent?->uuid ?? 'null').' type='.($agent?->type ?? ''), $t0);

$config = $agent->effectiveProviderConfig();
step('provider='.($config?->provider ?? 'null').' model='.($config?->model ?? ''), $t0);

$factory = app(LlmProviderFactory::class);
$tier = TaskModelTier::Standard;

$t = step('make primary start', $t0);
$primary = $factory->make($config, $tier);
step('make primary done', $t);

$t = step('discover ollama start', $t0);
$discovered = (new OllamaFallbackResolver)->discover();
step('discover done: '.json_encode($discovered), $t);

$t = step('makeForAgent start', $t0);
$provider = $factory->makeForAgent($agent, null, $tier);
step('makeForAgent done class='.$provider::class, $t);

$t = step('chat ping start', $t0);
try {
    $response = $provider->chat([
        ['role' => 'user', 'content' => 'Réponds uniquement: OK'],
    ], []);
    step('chat done tokens='.$response->tokensUsed.' text='.mb_substr((string) $response->text, 0, 80), $t);
} catch (Throwable $e) {
    step('chat ERROR: '.mb_substr($e->getMessage(), 0, 200), $t);
}
