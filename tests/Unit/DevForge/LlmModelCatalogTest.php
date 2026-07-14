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
