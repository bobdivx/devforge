#!/usr/bin/env php
<?php

require '/var/www/html/vendor/autoload.php';
$app = require '/var/www/html/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Models\AiAgentRun;
use App\Models\AiProviderConfig;
use Illuminate\Support\Facades\Http;

try {
    $config = AiProviderConfig::query()->where('provider', 'gemini')->orderByDesc('is_default')->first();

    if (! $config) {
        echo "NO_GEMINI_CONFIG\n";
        exit(1);
    }

    echo 'provider_id='.$config->id.PHP_EOL;
    echo 'model='.$config->model.PHP_EOL;
    echo 'has_key='.(strlen((string) $config->api_key) >= 8 ? 'yes' : 'no').PHP_EOL;

    $list = Http::withHeaders([
        'Authorization' => 'Bearer '.$config->api_key,
        'Accept' => 'application/json',
    ])->timeout(15)->get('https://generativelanguage.googleapis.com/v1beta/openai/models');

    echo 'models_list_status='.$list->status().PHP_EOL;

    if (! $list->successful()) {
        $body = $list->json();
        echo 'models_list_error='.mb_substr((string) ($body['error']['message'] ?? $list->body()), 0, 200).PHP_EOL;
    } else {
        echo 'models_count='.count($list->json('data') ?? []).PHP_EOL;
    }

    $chat = Http::withHeaders([
        'Authorization' => 'Bearer '.$config->api_key,
        'Accept' => 'application/json',
    ])->timeout(30)->post('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', [
        'model' => 'gemini-2.5-flash',
        'messages' => [
            ['role' => 'user', 'content' => 'Réponds uniquement: OK'],
        ],
        'max_tokens' => 16,
    ]);

    echo 'chat_status='.$chat->status().PHP_EOL;

    if ($chat->successful()) {
        echo 'chat_reply='.mb_substr((string) ($chat->json('choices.0.message.content') ?? ''), 0, 50).PHP_EOL;
        echo "GEMINI_OK\n";
        exit(0);
    }

    $body = $chat->json();
    echo 'chat_error='.mb_substr((string) ($body['error']['message'] ?? $chat->body()), 0, 400).PHP_EOL;

    echo 'agent_runs_today='.AiAgentRun::query()->where('created_at', '>=', now()->startOfDay())->count().PHP_EOL;
    echo 'agent_runs_last_hour='.AiAgentRun::query()->where('created_at', '>=', now()->subHour())->count().PHP_EOL;

    exit(2);
} catch (\Throwable $e) {
    echo 'FATAL: '.$e->getMessage().PHP_EOL;
    exit(255);
}
