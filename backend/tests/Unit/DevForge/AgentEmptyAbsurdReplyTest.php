<?php

use App\Services\DevForge\Agent\AgentChatEmptyReplyFallback;
use App\Services\DevForge\Agent\AgentEmptyAbsurdReply;
use App\Services\DevForge\Agent\LlmModelSize;

it('detects empty and whitespace assistant finals', function () {
    expect(AgentEmptyAbsurdReply::isEmptyOrAbsurd('', false))->toBeTrue()
        ->and(AgentEmptyAbsurdReply::isEmptyOrAbsurd('   ', false))->toBeTrue()
        ->and(AgentEmptyAbsurdReply::isEmptyOrAbsurd("\n\t", false))->toBeTrue();
});

it('detects known absurd single tokens from tiny ollama models', function (string $token) {
    expect(AgentEmptyAbsurdReply::isEmptyOrAbsurd($token, false))->toBeTrue()
        ->and(AgentEmptyAbsurdReply::isAbsurdToken($token))->toBeTrue();
})->with([
    'unfavored',
    'unfavourited',
    'favored',
    'Unfavored',
    'unfavored.',
]);

it('does not treat a french sentence as absurd', function () {
    expect(AgentEmptyAbsurdReply::isEmptyOrAbsurd(
        'Je relance le déploiement de starbasefr.',
        false,
        'corrige le déploiement',
    ))->toBeFalse()
        ->and(AgentEmptyAbsurdReply::isEmptyOrAbsurd('Bonjour', false, 'salut'))->toBeFalse();
});

it('flags short non-french gibberish only when the user intent needs tools', function () {
    expect(AgentEmptyAbsurdReply::isEmptyOrAbsurd('xyzzy', false, 'corrige le déploiement'))->toBeTrue()
        ->and(AgentEmptyAbsurdReply::isEmptyOrAbsurd('xyzzy', false, 'Bonjour'))->toBeFalse()
        ->and(AgentEmptyAbsurdReply::isEmptyOrAbsurd('xyzzy', true, 'corrige le déploiement'))->toBeFalse();
});

it('never surfaces garbage as history content', function () {
    expect(AgentEmptyAbsurdReply::historyContent('unfavored'))->toBe('…')
        ->and(AgentEmptyAbsurdReply::historyContent(''))->toBe('…')
        ->and(AgentEmptyAbsurdReply::historyContent('Relance en cours'))->toBe('Relance en cours');
});

it('builds a french user-facing failure that never contains unfavored', function () {
    $message = AgentEmptyAbsurdReply::userFacingFailureMessage('qwen2.5:3b');

    expect($message)->toContain('petit modèle')
        ->and($message)->toContain('qwen2.5:3b')
        ->and($message)->toContain('plus grand')
        ->and($message)->not->toContain('unfavored');
});

it('does not blame petit modele local when the failing provider is gemini cloud', function () {
    $message = AgentEmptyAbsurdReply::userFacingFailureMessage(
        'gemini-2.5-flash',
        'gemini',
        'https://generativelanguage.googleapis.com/v1beta/openai',
    );

    expect($message)->toContain('cloud')
        ->and($message)->toContain('gemini-2.5-flash')
        ->and($message)->not->toContain('petit modèle local')
        ->and($message)->not->toContain('trop d\'outils MCP')
        ->and(AgentEmptyAbsurdReply::isCloudProvider('gemini'))->toBeTrue()
        ->and(AgentEmptyAbsurdReply::isCloudProvider(null, null, 'generativelanguage.googleapis.com'))->toBeTrue()
        ->and(AgentEmptyAbsurdReply::isCloudProvider('ollama', 'qwen2.5:3b'))->toBeFalse();
});

it('detects rig empty completion errors from gemini', function () {
    $raw = 'Rig agent chat 502: {"error":"LLM error from generativelanguage.googleapis.com: CompletionError: ResponseError: Response contained no message or tool call (empty)."}';

    expect(AgentEmptyAbsurdReply::isEmptyCompletionFailure($raw))->toBeTrue()
        ->and(AgentChatEmptyReplyFallback::isEmptyCompletionFailure($raw))->toBeTrue()
        ->and(AgentEmptyAbsurdReply::isEmptyCompletionFailure('LLM timeout after 60s'))->toBeFalse();
});

it('picks a stronger installed ollama model than qwen2.5:3b', function () {
    $fallback = new AgentChatEmptyReplyFallback;

    expect($fallback->strongerOllamaModel('qwen2.5:3b', ['qwen2.5:3b', 'qwen2.5:14b']))->toBe('qwen2.5:14b')
        ->and($fallback->strongerOllamaModel('qwen2.5:3b', ['qwen2.5:3b']))->toBeNull()
        ->and($fallback->strongerOllamaModel('qwen2.5:3b', []))->toBeNull()
        ->and(AgentChatEmptyReplyFallback::isTinyOllamaModel('qwen2.5:3b'))->toBeTrue()
        ->and(AgentChatEmptyReplyFallback::isTinyOllamaModel('qwen2.5:7b'))->toBeFalse();
});

it('parses ollama parameter counts and flags models under 7B', function () {
    expect(LlmModelSize::parseParamBillions('qwen2.5:3b'))->toBe(3.0)
        ->and(LlmModelSize::parseParamBillions('qwen2.5:1b'))->toBe(1.0)
        ->and(LlmModelSize::parseParamBillions('llama3.2:1.5b'))->toBe(1.5)
        ->and(LlmModelSize::parseParamBillions('qwen2.5:0.5b'))->toBe(0.5)
        ->and(LlmModelSize::parseParamBillions('qwen2.5-coder:7b'))->toBe(7.0)
        ->and(LlmModelSize::parseParamBillions('qwen2.5:14b'))->toBe(14.0)
        ->and(LlmModelSize::parseParamBillions('llama3.2:3b-instruct-q4_0'))->toBe(3.0)
        ->and(LlmModelSize::parseParamBillions('mixtral:8x7b'))->toBeNull()
        ->and(LlmModelSize::parseParamBillions('gemini-2.5-flash'))->toBeNull()
        ->and(LlmModelSize::parseParamBillions('auto'))->toBeNull();

    expect(LlmModelSize::isTooSmallForTools('qwen2.5:3b'))->toBeTrue()
        ->and(LlmModelSize::isTooSmallForTools('qwen2.5:1b'))->toBeTrue()
        ->and(LlmModelSize::isTooSmallForTools('phi3:mini'))->toBeTrue()
        ->and(LlmModelSize::isTooSmallForTools('tinyllama'))->toBeTrue()
        ->and(LlmModelSize::isTooSmallForTools('qwen2.5-coder:7b'))->toBeFalse()
        ->and(LlmModelSize::isTooSmallForTools('qwen2.5:7b'))->toBeFalse()
        ->and(LlmModelSize::isTooSmallForTools('qwen2.5:14b'))->toBeFalse()
        ->and(LlmModelSize::isTooSmallForTools('gemini-2.5-flash'))->toBeFalse()
        ->and(LlmModelSize::isTooSmallForTools('auto'))->toBeFalse()
        ->and(LlmModelSize::isTooSmallForTools(null))->toBeFalse();
});
