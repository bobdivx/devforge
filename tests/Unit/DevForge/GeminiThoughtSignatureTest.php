<?php

use App\Services\DevForge\Agent\GeminiThoughtSignature;

it('injects skip validator when thought signature is missing', function () {
    $call = [
        'id' => 'call_1',
        'type' => 'function',
        'function' => ['name' => 'list_resources', 'arguments' => '{}'],
    ];

    $result = GeminiThoughtSignature::ensureOnToolCall($call);

    expect($result['extra_content']['google']['thought_signature'] ?? null)
        ->toBe(GeminiThoughtSignature::SKIP_VALIDATOR);
});

it('preserves an existing thought signature', function () {
    $call = [
        'extra_content' => [
            'google' => ['thought_signature' => 'sig_real_abc'],
        ],
    ];

    $result = GeminiThoughtSignature::ensureOnToolCall($call);

    expect($result['extra_content']['google']['thought_signature'])->toBe('sig_real_abc');
});
