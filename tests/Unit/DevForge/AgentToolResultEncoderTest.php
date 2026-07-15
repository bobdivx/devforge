<?php

use App\Services\DevForge\Agent\AgentToolResultEncoder;

it('truncates oversized tool results into valid json', function () {
    $payload = ['deployments' => [str_repeat('x', AgentToolResultEncoder::MAX_BYTES)]];

    $encoded = AgentToolResultEncoder::encode($payload);
    $decoded = json_decode($encoded, true);

    expect($decoded)->toBeArray()
        ->and($decoded['truncated'] ?? false)->toBeTrue()
        ->and(json_last_error())->toBe(JSON_ERROR_NONE);
});
