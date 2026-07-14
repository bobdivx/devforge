<?php

use App\Services\DevForge\Agent\AgentToolTurnBuilder;
use App\Services\DevForge\Agent\Contracts\LlmResponse;
use App\Services\DevForge\Agent\OllamaMessageNormalizer;
use App\Services\DevForge\Agent\Providers\OllamaProvider;
use Illuminate\Support\Facades\Http;

it('normalizes stringified tool arguments into objects', function () {
    expect(OllamaMessageNormalizer::normalizeToolArguments('{"type":"all"}'))
        ->toBe(['type' => 'all']);
});

it('returns an empty array for malformed tool argument strings', function () {
    expect(OllamaMessageNormalizer::normalizeToolArguments('{"type":"all"'))
        ->toBe([]);
});

it('formats assistant history with object arguments for ollama replay', function () {
    $messages = [
        ['role' => 'user', 'content' => 'Inspecte'],
        [
            'role' => 'assistant',
            'content' => '',
            'tool_calls' => [[
                'id' => 'call_1',
                'type' => 'function',
                'function' => [
                    'name' => 'list_resources',
                    'arguments' => '{"type":"all"}',
                ],
            ]],
        ],
        [
            'role' => 'tool',
            'name' => 'list_resources',
            'content' => '{"resources":[]}',
        ],
    ];

    $formatted = OllamaMessageNormalizer::formatMessages($messages);
    $arguments = $formatted[1]['tool_calls'][0]['function']['arguments'] ?? null;

    expect($arguments)->toBeArray()
        ->and($arguments)->toBe(['type' => 'all'])
        ->and($formatted[2]['name'] ?? null)->toBe('list_resources');
});

it('sends replayed tool call arguments as objects to ollama', function () {
    Http::fake([
        'http://ollama.test/api/chat' => Http::sequence()
            ->push([
                'message' => [
                    'content' => '',
                    'tool_calls' => [[
                        'function' => [
                            'name' => 'list_resources',
                            'arguments' => ['type' => 'all'],
                        ],
                    ]],
                ],
                'done' => true,
            ])
            ->push([
                'message' => ['content' => 'Terminé.', 'tool_calls' => []],
                'done' => true,
            ]),
    ]);

    $provider = new OllamaProvider('http://ollama.test', 'llama3.2:latest');
    $messages = [['role' => 'user', 'content' => 'Inspecte']];
    $tools = [[
        'name' => 'list_resources',
        'description' => 'Liste les ressources',
        'parameters' => ['type' => 'object', 'properties' => []],
    ]];

    $response = $provider->chat($messages, $tools);

    AgentToolTurnBuilder::append($messages, $response, [[
        'name' => 'list_resources',
        'result' => ['resources' => []],
    ]]);

    $provider->chat($messages, $tools);

    Http::assertSentCount(2);

    Http::assertSent(function ($request): bool {
        if (! str_contains($request->url(), '/api/chat')) {
            return false;
        }

        $payload = json_decode($request->body(), true);
        $assistant = collect($payload['messages'] ?? [])
            ->first(fn (array $message): bool => ($message['role'] ?? '') === 'assistant' && ! empty($message['tool_calls']));

        if (! is_array($assistant)) {
            return false;
        }

        $arguments = $assistant['tool_calls'][0]['function']['arguments'] ?? null;

        return is_array($arguments) && ($arguments['type'] ?? null) === 'all';
    });
});
