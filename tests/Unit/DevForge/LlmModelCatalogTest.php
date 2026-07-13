<?php

use App\Services\DevForge\Agent\LlmModelCatalog;
use Illuminate\Support\Facades\Http;

it('lists gemini models that support generateContent', function () {
    Http::fake([
        'generativelanguage.googleapis.com/v1beta/models*' => Http::response([
            'models' => [
                [
                    'name' => 'models/gemini-2.5-flash',
                    'displayName' => 'Gemini 2.5 Flash',
                    'description' => 'Fast model',
                    'supportedGenerationMethods' => ['generateContent', 'countTokens'],
                ],
                [
                    'name' => 'models/text-embedding-004',
                    'displayName' => 'Text Embedding',
                    'supportedGenerationMethods' => ['embedContent'],
                ],
            ],
        ]),
    ]);

    $models = app(LlmModelCatalog::class)->listForProvider('gemini', apiKey: 'AIzaTestKey');

    expect($models)->toHaveCount(1)
        ->and($models[0]['id'])->toBe('gemini-2.5-flash')
        ->and($models[0]['label'])->toBe('Gemini 2.5 Flash');
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
