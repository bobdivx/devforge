<?php

use App\Services\DevForge\Agent\LlmEndpointResolver;
use App\Services\DevForge\Agent\LlmModelCatalog;
use App\Services\DevForge\Agent\LlmProviderRegistry;
use App\Services\DevForge\Agent\Providers\AnthropicProvider;
use App\Services\DevForge\Agent\Providers\OpenAiCompatibleProvider;
use Illuminate\Support\Facades\Http;

it('lists known llm providers', function () {
    expect(LlmProviderRegistry::ALL)->toContain('openai', 'openrouter', 'anthropic')
        ->and(LlmProviderRegistry::isSupported('openai'))->toBeTrue()
        ->and(LlmProviderRegistry::defaultBaseUrl('openai'))->toBe('https://api.openai.com/v1')
        ->and(LlmProviderRegistry::defaultModel('anthropic'))->toContain('claude');
});

it('resolves openai compatible base urls with defaults', function () {
    expect(LlmEndpointResolver::openAiCompatibleBaseUrl('openai', null))
        ->toBe('https://api.openai.com/v1')
        ->and(LlmEndpointResolver::openAiCompatibleBaseUrl('openrouter', 'https://example.com/v1/'))
        ->toBe('https://example.com/v1')
        ->and(LlmEndpointResolver::anthropicBaseUrl(null))
        ->toBe('https://api.anthropic.com/v1');
});

it('sanitizes openai provider configs with default base url', function () {
    expect(LlmEndpointResolver::sanitizeProviderConfig([
        'provider' => 'openai',
        'base_url' => null,
    ]))->toBe(['base_url' => 'https://api.openai.com/v1']);
});

it('lists openai models from openai compatible catalog', function () {
    Http::fake([
        'api.openai.com/*' => Http::response([
            'data' => [
                ['id' => 'gpt-4o-mini', 'owned_by' => 'openai'],
                ['id' => 'text-embedding-3-small', 'owned_by' => 'openai'],
            ],
        ]),
    ]);

    $models = app(LlmModelCatalog::class)->listForProvider('openai', apiKey: 'sk-test');

    expect($models)->not->toBeEmpty()
        ->and(collect($models)->pluck('id')->all())->toContain('gpt-4o-mini');
});

it('chats via openai compatible provider', function () {
    Http::fake([
        'api.openai.com/v1/chat/completions' => Http::response([
            'choices' => [[
                'message' => [
                    'content' => 'bonjour',
                    'tool_calls' => [[
                        'id' => 'call_1',
                        'function' => [
                            'name' => 'web_search',
                            'arguments' => '{"query":"coolify"}',
                        ],
                    ]],
                ],
                'finish_reason' => 'tool_calls',
            ]],
            'usage' => ['total_tokens' => 42],
        ]),
    ]);

    $provider = new OpenAiCompatibleProvider(
        apiKey: 'sk-test',
        model: 'gpt-4o-mini',
        baseUrl: 'https://api.openai.com/v1',
        label: 'openai',
    );

    $response = $provider->chat([
        ['role' => 'user', 'content' => 'hi'],
    ], [
        ['name' => 'web_search', 'description' => 'search', 'parameters' => ['type' => 'object']],
    ]);

    expect($response->text)->toBe('bonjour')
        ->and($response->toolCalls)->toHaveCount(1)
        ->and($response->toolCalls[0]['name'])->toBe('web_search')
        ->and($response->tokensUsed)->toBe(42);
});

it('chats via anthropic provider and maps tool use', function () {
    Http::fake([
        'api.anthropic.com/v1/messages' => Http::response([
            'content' => [
                ['type' => 'text', 'text' => 'ok'],
                [
                    'type' => 'tool_use',
                    'id' => 'toolu_1',
                    'name' => 'todo_read',
                    'input' => [],
                ],
            ],
            'stop_reason' => 'tool_use',
            'usage' => ['input_tokens' => 10, 'output_tokens' => 5],
        ]),
    ]);

    $provider = new AnthropicProvider(apiKey: 'sk-ant-test', model: 'claude-sonnet-4-20250514');

    $response = $provider->chat([
        ['role' => 'system', 'content' => 'Tu es DevForge.'],
        ['role' => 'user', 'content' => 'lis les todos'],
    ], [
        ['name' => 'todo_read', 'description' => 'read todos', 'parameters' => ['type' => 'object', 'properties' => []]],
    ]);

    expect($response->text)->toBe('ok')
        ->and($response->toolCalls)->toHaveCount(1)
        ->and($response->toolCalls[0]['id'])->toBe('toolu_1')
        ->and($response->tokensUsed)->toBe(15);
});
