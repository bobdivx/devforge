<?php

$basePath = is_dir('/var/www/html/vendor') ? '/var/www/html' : dirname(__DIR__);

require $basePath.'/vendor/autoload.php';
$app = require $basePath.'/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Models\AiAgent;
use App\Models\AiAgentRun;
use App\Services\DevForge\Agent\AgentChatService;
use App\Services\DevForge\Agent\AgentRunner;

$agent = AiAgent::query()->with('team')->first();
if (! $agent) {
    echo "NO_AGENT\n";
    exit(0);
}

$run = AiAgentRun::query()->create([
    'agent_id' => $agent->id,
    'status' => 'running',
    'trigger' => 'chat',
]);

$runner = app(AgentRunner::class);
$chat = app(AgentChatService::class);

echo 'runner='.get_class($runner)."\n";
echo 'chat='.get_class($chat)."\n";

$ref = new ReflectionClass($chat);
$method = $ref->getMethod('generateReply');
$method->setAccessible(true);

try {
    $method->invoke($chat, $agent, $run);
    echo "generateReply=OK\n";
} catch (Throwable $e) {
    echo 'generateReply=FAIL: '.$e->getMessage()."\n";
    exit(1);
}

echo "DONE\n";
