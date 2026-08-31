<?php

use App\Services\DevForge\Agent\LlmModelCatalog;
use Illuminate\Support\Facades\Http;

it('lists only chat compatible gemini models from openai endpoint', function () {
    Http::fake([
        'generativelanguage.googleapis.com/*' => Http::response([
            'data' => [
                ['id' => 'gemini-2.5-flash', 'owned_by' => 'google'],
                ['id' => 'gemini-2.5-flash-native-audio-latest', 'owned_by' => 'google'],
                ['id' => 'gemini-2.5-flash-image', 'owned_by' => 'google'],
                ['id' => 'text-embedding-004', 'owned_by' => 'google'],
            ],
        ]),
    ]);

    $models = app(LlmModelCatalog::class)->listForProvider('gemini', apiKey: 'AIzaTestKey');

    expect($models)->toHaveCount(1)
        ->and($models[0]['id'])->toBe('gemini-2.5-flash');
});

it('lists ollama models from tags endpoint', function () {
    Http::fake([
        'http://localhost:11434/api/tags' => Http::response([
            'models' => [
                ['name' => 'llama3.2', 'details' => ['family' => 'llama']],
                ['name' => 'mistral', 'details' => ['family' => 'mistral']],
            ],
        ]),
    ]);

    $models = app(LlmModelCatalog::class)->listForProvider('ollama', baseUrl: 'http://localhost:11434');

    expect($models)->toHaveCount(2)
        ->and($models[0]['id'])->toBe('llama3.2');
});

it('requires credentials for each provider', function () {
    $catalog = app(LlmModelCatalog::class);

    expect(fn () => $catalog->listForProvider('gemini'))
        ->toThrow(InvalidArgumentException::class);

    expect(fn () => $catalog->listForProvider('ollama'))
        ->toThrow(InvalidArgumentException::class);
});

it('lists openai compatible models with /v1 fallback and diverse JSON formats', function () {
    Http::fake([
        '10.1.0.88:10086/models' => Http::response('Not Found', 404),
        '10.1.0.88:10086/v1/models' => Http::response([
            'data' => [
                ['id' => 'qwen3', 'owned_by' => 'local'],
                ['id' => 'qwen2.5-coder', 'owned_by' => 'local'],
            ],
        ]),
    ]);

    $models = app(LlmModelCatalog::class)->listForProvider('openai', apiKey: null, baseUrl: 'http://10.1.0.88:10086');

    expect($models)->toHaveCount(2)
        ->and(collect($models)->pluck('id')->all())->toContain('qwen3', 'qwen2.5-coder');
});

it('lists openai models from models key or array of strings', function () {
    Http::fake([
        'qwen.briseteia.me/models' => Http::response([
            'models' => [
                ['name' => 'qwen3', 'description' => 'Qwen 3 Local'],
            ],
        ]),
    ]);

    $models = app(LlmModelCatalog::class)->listForProvider('openai', apiKey: 'dummy', baseUrl: 'https://qwen.briseteia.me');

    expect($models)->toHaveCount(1)
        ->and($models[0]['id'])->toBe('qwen3');
});
