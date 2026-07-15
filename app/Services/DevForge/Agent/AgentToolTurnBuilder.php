<?php

namespace App\Services\DevForge\Agent;

use App\Services\DevForge\Agent\Contracts\LlmResponse;
use Illuminate\Support\Str;

class AgentToolTurnBuilder
{
    /**
     * @param  array<int, array<string, mixed>>  $messages
     * @param  array<int, array{name: string, result: mixed}>  $toolResults
     */
    public static function append(array &$messages, LlmResponse $response, array $toolResults): void
    {
        $toolCalls = [];

        foreach ($response->toolCalls as $index => $toolCall) {
            $toolCallId = ($toolCall['id'] ?? '') !== ''
                ? (string) $toolCall['id']
                : 'call_'.Str::uuid()->toString();

            $entry = [
                'id' => $toolCallId,
                'type' => 'function',
                'function' => [
                    'name' => $toolCall['name'],
                    'arguments' => json_encode($toolCall['arguments'], JSON_UNESCAPED_UNICODE),
                ],
            ];

            if (! empty($toolCall['extra_content']) && is_array($toolCall['extra_content'])) {
                $entry['extra_content'] = $toolCall['extra_content'];
            }

            $toolCalls[] = GeminiThoughtSignature::ensureOnToolCall($entry);
        }

        $assistantMessage = [
            'role' => 'assistant',
            'content' => $response->text !== '' ? $response->text : '',
        ];

        if ($toolCalls !== []) {
            $assistantMessage['tool_calls'] = $toolCalls;
        }

        $messages[] = $assistantMessage;

        foreach ($response->toolCalls as $index => $toolCall) {
            $toolCallId = $toolCalls[$index]['id'];
            $result = $toolResults[$index]['result'] ?? null;

            $messages[] = [
                'role' => 'tool',
                'tool_call_id' => $toolCallId,
                'name' => (string) ($toolCall['name'] ?? ''),
                'content' => AgentToolResultEncoder::encode($result),
            ];
        }
    }
}
