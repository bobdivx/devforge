<?php

use App\Services\DevForge\Agent\LlmEndpointResolver;

it('ignores ollama localhost urls for gemini providers', function () {
    expect(LlmEndpointResolver::geminiBaseUrl('http://localhost:11434'))
        ->toBe('https://generativelanguage.googleapis.com/v1beta/openai');
});

it('keeps a valid custom gemini openai base url', function () {
    expect(LlmEndpointResolver::geminiBaseUrl('https://generativelanguage.googleapis.com/v1beta/openai'))
        ->toBe('https://generativelanguage.googleapis.com/v1beta/openai');
});

it('rewrites ollama localhost to host docker internal by default', function () {
    expect(LlmEndpointResolver::ollamaBaseUrl('http://localhost:11434'))
        ->toBe('http://host.docker.internal:11434');
});

it('clears base url when sanitizing gemini provider configs', function () {
    expect(LlmEndpointResolver::sanitizeProviderConfig([
        'provider' => 'gemini',
        'base_url' => 'http://localhost:11434',
    ]))->toBe(['base_url' => null]);
});

it('detects public https ollama tunnels and keeps lan urls local', function () {
    expect(LlmEndpointResolver::isPublicHttpsTunnel('https://ollama.briseteia.me'))->toBeTrue()
        ->and(LlmEndpointResolver::isPublicHttpsTunnel('http://10.1.0.58:11434'))->toBeFalse()
        ->and(LlmEndpointResolver::isPublicHttpsTunnel('http://host.docker.internal:11434'))->toBeFalse()
        ->and(LlmEndpointResolver::urlHost('https://ollama.briseteia.me/v1'))->toBe('ollama.briseteia.me');
});
