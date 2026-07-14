<?php

use App\Services\DevForge\Agent\AgentToolTurnBuilder;
use App\Services\DevForge\Agent\LlmModelResolver;
use App\Services\DevForge\Agent\Providers\GeminiModelFailoverProvider;
use App\Services\DevForge\Agent\Providers\GeminiProvider;
use Illuminate\Support\Facades\Http;

it('uses the openai compatible gemini endpoint with bearer auth', function () {
    Http::fake([
        'generativelanguage.googleapis.com/*' => Http::response([
            'choices' => [
                [
                    'message' => ['role' => 'assistant', 'content' => 'OK'],
                    'finish_reason' => 'stop',
                ],
            ],
            'usage' => ['total_tokens' => 12],
        ]),
    ]);

    $provider = new GeminiProvider('AIzaTestKey', 'gemini-2.5-flash');

    $response = $provider->chat([
        ['role' => 'system', 'content' => 'Tu es un agent de débogage.'],
        ['role' => 'user', 'content' => 'Premier message'],
        ['role' => 'assistant', 'content' => 'Réponse intermédiaire'],
        ['role' => 'user', 'content' => 'Deuxième message'],
    ]);

    expect($response->text)->toBe('OK');

    Http::assertSent(function ($request): bool {
        expect($request->url())->toContain('/v1beta/openai/chat/completions')
            ->and($request->hasHeader('Authorization', 'Bearer AIzaTestKey'));

        $payload = json_decode($request->body(), true);

        expect($payload['model'])->toBe('gemini-2.5-flash')
            ->and($payload['messages'])->toHaveCount(4)
            ->and($payload['messages'][0]['role'])->toBe('system');

        return true;
    });
});

it('sends tools using the openai function schema', function () {
    Http::fake([
        'generativelanguage.googleapis.com/*' => Http::response([
            'choices' => [
                [
                    'message' => ['role' => 'assistant', 'content' => 'OK'],
                    'finish_reason' => 'stop',
                ],
            ],
            'usage' => ['total_tokens' => 8],
        ]),
    ]);

    $provider = new GeminiProvider('AIzaTestKey', 'gemini-2.5-flash');

    $provider->chat(
        [
            ['role' => 'user', 'content' => 'Liste les ressources'],
        ],
        [
            5 => [
                'name' => 'list_resources',
                'description' => 'Liste les ressources de l\'équipe',
                'parameters' => ['type' => 'object', 'properties' => []],
            ],
        ],
    );

    Http::assertSent(function ($request): bool {
        $payload = json_decode($request->body(), true);
        $tools = $payload['tools'] ?? null;

        expect($tools)->toBeArray()
            ->and(array_is_list($tools))->toBeTrue()
            ->and($tools[0]['type'])->toBe('function')
            ->and($tools[0]['function']['name'])->toBe('list_resources');

        return true;
    });
});

it('retries gemini requests when the model is temporarily overloaded', function () {
    Illuminate\Support\Sleep::fake();

    Http::fake([
        'generativelanguage.googleapis.com/*' => Http::sequence()
            ->push(['error' => ['message' => 'high demand']], 503)
            ->push([
                'choices' => [
                    [
                        'message' => ['role' => 'assistant', 'content' => 'OK'],
                        'finish_reason' => 'stop',
                    ],
                ],
                'usage' => ['total_tokens' => 4],
            ]),
    ]);

    $provider = new GeminiProvider('AIzaTestKey', 'gemini-2.5-flash');

    $response = $provider->chat([
        ['role' => 'user', 'content' => 'Bonjour'],
    ]);

    expect($response->text)->toBe('OK');
    Http::assertSentCount(2);
});

it('formats overloaded model errors clearly', function () {
    Illuminate\Support\Sleep::fake();

    Http::fake([
        'generativelanguage.googleapis.com/*' => Http::response([
            'error' => ['message' => 'This model is currently experiencing high demand.'],
        ], 503),
    ]);

    $provider = new GeminiProvider('AIzaTestKey', 'gemini-2.5-flash');

    expect(fn () => $provider->chat([['role' => 'user', 'content' => 'test']]))
        ->toThrow(RuntimeException::class, 'surchargé');
});

it('marks function call responses as unfinished so another round trip can run', function () {
    Http::fake([
        'generativelanguage.googleapis.com/*' => Http::response([
            'choices' => [
                [
                    'message' => [
                        'role' => 'assistant',
                        'content' => '',
                        'tool_calls' => [
                            [
                                'id' => 'call_123',
                                'type' => 'function',
                                'function' => [
                                    'name' => 'list_resources',
                                    'arguments' => '{"type":"all"}',
                                ],
                            ],
                        ],
                    ],
                    'finish_reason' => 'stop',
                ],
            ],
            'usage' => ['total_tokens' => 4],
        ]),
    ]);

    $provider = new GeminiProvider('AIzaTestKey', 'gemini-2.5-flash');

    $response = $provider->chat(
        [['role' => 'user', 'content' => 'Liste les ressources']],
        [
            [
                'name' => 'list_resources',
                'description' => 'Liste les ressources',
                'parameters' => ['type' => 'object', 'properties' => []],
            ],
        ],
    );

    expect($response->hasToolCalls())->toBeTrue()
        ->and($response->isFinished)->toBeFalse()
        ->and($response->toolCalls[0]['id'])->toBe('call_123');
});

it('sends tool results with tool_call_id on follow up turns', function () {
    Http::fake([
        'generativelanguage.googleapis.com/*' => Http::sequence()
            ->push([
                'choices' => [
                    [
                        'message' => [
                            'role' => 'assistant',
                            'content' => '',
                            'tool_calls' => [
                                [
                                    'id' => 'call_abc',
                                    'type' => 'function',
                                    'function' => [
                                        'name' => 'list_resources',
                                        'arguments' => '{"type":"all"}',
                                    ],
                                ],
                            ],
                        ],
                        'finish_reason' => 'stop',
                    ],
                ],
                'usage' => ['total_tokens' => 4],
            ])
            ->push([
                'choices' => [
                    [
                        'message' => ['role' => 'assistant', 'content' => 'Vous avez 1 serveur actif.'],
                        'finish_reason' => 'stop',
                    ],
                ],
                'usage' => ['total_tokens' => 8],
            ]),
    ]);

    $provider = new GeminiProvider('AIzaTestKey', 'gemini-2.5-flash');
    $tools = [
        [
            'name' => 'list_resources',
            'description' => 'Liste les ressources',
            'parameters' => ['type' => 'object', 'properties' => []],
        ],
    ];

    $messages = [['role' => 'user', 'content' => 'Quel est l\'état de mes ressources ?']];
    $first = $provider->chat($messages, $tools);

    AgentToolTurnBuilder::append($messages, $first, [
        ['name' => 'list_resources', 'result' => ['resources' => ['servers' => []]]],
    ]);

    $second = $provider->chat($messages, $tools);

    expect($second->text)->toBe('Vous avez 1 serveur actif.');

    Http::assertSent(function ($request, $index): bool {
        if ($index !== 1) {
            return true;
        }

        $payload = json_decode($request->body(), true);
        $toolMessage = collect($payload['messages'] ?? [])->firstWhere('role', 'tool');

        expect($toolMessage['tool_call_id'] ?? null)->toBe('call_abc');

        return true;
    });
});

it('falls back to another gemini model when the primary model is rate limited', function () {
    Illuminate\Support\Sleep::fake();

    Http::fake([
        'generativelanguage.googleapis.com/*' => Http::sequence()
            ->push(['error' => ['message' => 'quota exceeded']], 429)
            ->push([
                'choices' => [
                    [
                        'message' => ['role' => 'assistant', 'content' => 'OK via fallback'],
                        'finish_reason' => 'stop',
                    ],
                ],
                'usage' => ['total_tokens' => 4],
            ]),
    ]);

    $provider = new GeminiModelFailoverProvider('AIzaTestKey', 'gemini-2.0-flash-lite');

    $response = $provider->chat([
        ['role' => 'user', 'content' => 'Bonjour'],
    ]);

    expect($response->text)->toBe('OK via fallback');
    Http::assertSentCount(2);
});

it('preserves gemini thought signatures on follow up tool turns', function () {
    Http::fake([
        'generativelanguage.googleapis.com/*' => Http::sequence()
            ->push([
                'choices' => [
                    [
                        'message' => [
                            'role' => 'assistant',
                            'content' => '',
                            'tool_calls' => [
                                [
                                    'id' => 'call_sig',
                                    'type' => 'function',
                                    'function' => [
                                        'name' => 'list_resources',
                                        'arguments' => '{"type":"all"}',
                                    ],
                                    'extra_content' => [
                                        'google' => ['thought_signature' => 'sig_test_123'],
                                    ],
                                ],
                            ],
                        ],
                        'finish_reason' => 'stop',
                    ],
                ],
                'usage' => ['total_tokens' => 4],
            ])
            ->push([
                'choices' => [
                    [
                        'message' => ['role' => 'assistant', 'content' => 'OK'],
                        'finish_reason' => 'stop',
                    ],
                ],
                'usage' => ['total_tokens' => 4],
            ]),
    ]);

    $provider = new GeminiProvider('AIzaTestKey', 'gemini-2.5-flash');
    $messages = [['role' => 'user', 'content' => 'Liste']];
    $first = $provider->chat($messages, [[
        'name' => 'list_resources',
        'description' => 'Liste',
        'parameters' => ['type' => 'object', 'properties' => []],
    ]]);

    AgentToolTurnBuilder::append($messages, $first, [
        ['name' => 'list_resources', 'result' => ['ok' => true]],
    ]);

    $provider->chat($messages);

    Http::assertSent(function ($request, $index): bool {
        if ($index !== 1) {
            return true;
        }

        $payload = json_decode($request->body(), true);
        $assistant = collect($payload['messages'] ?? [])->firstWhere('role', 'assistant');
        $signature = $assistant['tool_calls'][0]['extra_content']['google']['thought_signature'] ?? null;

        expect($signature)->toBe('sig_test_123');

        return true;
    });
});

it('stops model failover when gemini quota is globally exhausted', function () {
    Http::fake([
        'generativelanguage.googleapis.com/*' => Http::response([
            'error' => ['message' => 'You exceeded your current quota, please check your plan and billing details.'],
        ], 429),
    ]);

    $provider = new GeminiModelFailoverProvider(
        'AIzaTestKey',
        LlmModelResolver::AUTO,
        autoModels: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash'],
    );

    expect(fn () => $provider->chat([['role' => 'user', 'content' => 'test']]))
        ->toThrow(RuntimeException::class, 'Quota Gemini atteint');

    Http::assertSentCount(1);
});

it('tries multiple auto models when the first model is unavailable', function () {
    Http::fake([
        'generativelanguage.googleapis.com/*' => Http::sequence()
            ->push(['error' => ['message' => 'model not found']], 404)
            ->push([
                'choices' => [
                    [
                        'message' => ['role' => 'assistant', 'content' => 'OK auto'],
                        'finish_reason' => 'stop',
                    ],
                ],
                'usage' => ['total_tokens' => 4],
            ]),
    ]);

    $provider = new GeminiModelFailoverProvider(
        'AIzaTestKey',
        LlmModelResolver::AUTO,
        autoModels: ['gemini-2.5-flash', 'gemini-2.0-flash-lite'],
    );

    $response = $provider->chat([
        ['role' => 'user', 'content' => 'Bonjour'],
    ]);

    expect($response->text)->toBe('OK auto');
    Http::assertSentCount(2);
});
