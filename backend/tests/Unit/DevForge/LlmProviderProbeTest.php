<?php

use App\Models\AiProviderConfig;
use App\Models\Team;
use App\Services\DevForge\Agent\LlmProviderProbe;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;

uses(RefreshDatabase::class);

it('lists gemini models and probes which ones answer a micro-chat', function () {
    Cache::flush();

    Http::fake([
        'generativelanguage.googleapis.com/*/models' => Http::response([
            'data' => [
                ['id' => 'gemini-2.5-flash', 'owned_by' => 'google'],
                ['id' => 'gemini-2.0-flash-lite', 'owned_by' => 'google'],
                ['id' => 'text-embedding-004', 'owned_by' => 'google'],
            ],
        ]),
        'generativelanguage.googleapis.com/*/chat/completions' => Http::sequence()
            ->push([
                'error' => ['message' => 'You exceeded your current quota'],
            ], 429)
            ->push([
                'choices' => [
                    ['message' => ['role' => 'assistant', 'content' => 'OK'], 'finish_reason' => 'stop'],
                ],
            ]),
    ]);

    $team = Team::factory()->create();
    $config = AiProviderConfig::factory()->create([
        'team_id' => $team->id,
        'provider' => 'gemini',
        'model' => 'auto',
        'api_key' => 'AIzaTestKey',
    ]);

    $report = app(LlmProviderProbe::class)->diagnose(
        $config,
        preferredModels: ['gemini-2.0-flash-lite', 'gemini-2.5-flash'],
        useCache: false,
    );

    expect($report['ok'])->toBeTrue()
        ->and($report['models_available'])->toContain('gemini-2.5-flash')
        ->and($report['models_available'])->toContain('gemini-2.0-flash-lite')
        ->and($report['recommended'][0])->toBe('gemini-2.5-flash');

    $failed = collect($report['models_probed'])->firstWhere('id', 'gemini-2.0-flash-lite');
    $ok = collect($report['models_probed'])->firstWhere('id', 'gemini-2.5-flash');

    expect($failed['ok'])->toBeFalse()
        ->and($ok['ok'])->toBeTrue();
});

it('reports ollama as down when tags endpoint is unreachable', function () {
    Cache::flush();

    Http::fake([
        'http://127.0.0.1:11434/*' => Http::response('bad gateway', 502),
    ]);

    $team = Team::factory()->create();
    $config = AiProviderConfig::factory()->create([
        'team_id' => $team->id,
        'provider' => 'ollama',
        'model' => 'llama3.2',
        'base_url' => 'http://127.0.0.1:11434',
    ]);

    $report = app(LlmProviderProbe::class)->diagnose($config, useCache: false);

    expect($report['ok'])->toBeFalse()
        ->and($report['summary'])->toContain('Ollama');
});
