<?php

use App\Services\DevForge\Agent\OllamaFallbackResolver;
use Illuminate\Support\Facades\Http;

it('discovers ollama from configured url', function () {
    config()->set('devforge.ollama_url', 'http://10.1.0.58:11434');

    Http::fake([
        '10.1.0.58:11434/api/tags' => Http::response([
            'models' => [
                ['name' => 'llama3.2:3b'],
            ],
        ]),
    ]);

    $discovered = (new OllamaFallbackResolver)->discover();

    expect($discovered)->toBe([
        'base_url' => 'http://10.1.0.58:11434',
        'model' => 'llama3.2:3b',
    ]);
});

it('returns null when no ollama server is reachable', function () {
    Http::fake([
        '*' => Http::response('', 404),
    ]);

    expect((new OllamaFallbackResolver)->discover())->toBeNull();
});
