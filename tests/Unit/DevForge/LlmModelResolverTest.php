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
        'gemini-2.5-flash-native-audio-latest',
    ]);

    expect($ordered)->toBe(['gemini-2.0-flash-lite', 'gemini-2.5-flash']);
});

it('excludes non chat gemini models from auto selection', function () {
    expect(LlmModelResolver::isChatCompatibleGeminiModel('gemini-2.5-flash'))->toBeTrue()
        ->and(LlmModelResolver::isChatCompatibleGeminiModel('gemini-2.5-flash-native-audio-latest'))->toBeFalse()
        ->and(LlmModelResolver::isChatCompatibleGeminiModel('gemini-2.5-flash-image'))->toBeFalse()
        ->and(LlmModelResolver::isChatCompatibleGeminiModel('gemini-2.5-computer-use-preview-10-2025'))->toBeFalse()
        ->and(LlmModelResolver::isChatCompatibleGeminiModel('gemini-3-flash-preview'))->toBeFalse();
});

it('limits auto routing to stable gemini 2.x tool models', function () {
    expect(LlmModelResolver::isStableToolCallingGeminiModel('gemini-2.5-flash'))->toBeTrue()
        ->and(LlmModelResolver::isStableToolCallingGeminiModel('gemini-3.5-flash'))->toBeFalse()
        ->and(LlmModelResolver::isStableToolCallingGeminiModel('gemini-3.1-pro-preview-customtools'))->toBeFalse();

    $ordered = LlmModelResolver::prioritizeGeminiModels([
        'gemini-2.5-flash',
        'gemini-3.5-flash',
        'gemini-2.0-flash-lite',
    ]);

    expect($ordered)->toBe(['gemini-2.5-flash', 'gemini-2.0-flash-lite']);
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

it('excludes code-only ollama models from tool calling selection', function () {
    expect(LlmModelResolver::isToolCallingOllamaModel('llama3.2:latest'))->toBeTrue()
        ->and(LlmModelResolver::isToolCallingOllamaModel('qwen2.5:7b'))->toBeTrue()
        ->and(LlmModelResolver::isToolCallingOllamaModel('codegemma:2b'))->toBeFalse()
        ->and(LlmModelResolver::isToolCallingOllamaModel('nomic-embed-text'))->toBeFalse();
});

it('prioritizes tool-capable ollama models for auto mode', function () {
    $ordered = LlmModelResolver::prioritizeOllamaModelsForTools([
        'codegemma:2b',
        'gemma4:latest',
        'qwen2.5:7b',
        'llama3.2:latest',
    ]);

    expect($ordered[0])->toBe('llama3.2:latest')
        ->and($ordered[1])->toBe('qwen2.5:7b')
        ->and($ordered)->not->toContain('codegemma:2b');
});
