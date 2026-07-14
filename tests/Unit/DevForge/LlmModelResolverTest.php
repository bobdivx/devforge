<?php

use App\Models\AiProviderConfig;
use App\Models\Team;
use App\Services\DevForge\Agent\LlmModelResolver;

it('treats empty and auto as auto model mode', function () {
    expect(LlmModelResolver::isAuto(null))->toBeTrue();
    expect(LlmModelResolver::isAuto(''))->toBeTrue();
    expect(LlmModelResolver::isAuto('auto'))->toBeTrue();
    expect(LlmModelResolver::isAuto('AUTO'))->toBeTrue();
    expect(LlmModelResolver::isAuto('gemini-2.5-flash'))->toBeFalse();
});

it('resolves auto sentinel in auto mode', function () {
    $gemini = AiProviderConfig::factory()->gemini()->make(['model' => LlmModelResolver::AUTO]);
    $ollama = AiProviderConfig::factory()->ollama()->make(['model' => LlmModelResolver::AUTO]);

    expect(LlmModelResolver::resolvedModel($gemini))->toBe(LlmModelResolver::AUTO);
    expect(LlmModelResolver::resolvedModel($ollama))->toBe(LlmModelResolver::AUTO);
});

it('prioritizes lite gemini models when catalog is available', function () {
    $ordered = LlmModelResolver::prioritizeGeminiModels([
        'gemini-2.5-flash',
        'gemini-2.0-flash-lite',
        'gemini-embedding-001',
    ]);

    expect($ordered[0])->toBe('gemini-2.0-flash-lite')
        ->and($ordered[1])->toBe('gemini-2.5-flash');
});

it('keeps explicit model when not auto', function () {
    $config = AiProviderConfig::factory()->gemini()->make(['model' => 'gemini-2.0-flash']);

    expect(LlmModelResolver::resolvedModel($config))->toBe('gemini-2.0-flash');
    expect(LlmModelResolver::displayLabel($config))->toBe('gemini-2.0-flash');
});

it('displays auto label for auto providers', function () {
    $config = AiProviderConfig::factory()->gemini()->make(['model' => LlmModelResolver::AUTO]);

    expect(LlmModelResolver::displayLabel($config))->toBe('Auto');
    expect(LlmModelResolver::displayProviderLabel($config))->toBe('gemini/Auto');
});

it('normalizes stored model to auto sentinel', function () {
    expect(LlmModelResolver::normalizeStoredModel(null))->toBe(LlmModelResolver::AUTO);
    expect(LlmModelResolver::normalizeStoredModel(''))->toBe(LlmModelResolver::AUTO);
    expect(LlmModelResolver::normalizeStoredModel('gemini-2.5-flash'))->toBe('gemini-2.5-flash');
});
