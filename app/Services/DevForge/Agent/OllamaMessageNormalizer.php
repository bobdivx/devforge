<?php

namespace App\Services\DevForge\Agent;

/**
 * Normalise les messages OpenAI/Gemini vers le format natif Ollama (/api/chat).
 */
class OllamaMessageNormalizer
{
    private const MAX_CONTENT_LENGTH = 16000;

    /**
     * @param  array<int, array<string, mixed>>  $messages
     * @return array<int, array<string, mixed>>
     */
    public static function formatMessages(array $messages): array
    {
        return array_values(array_map(
            fn (array $message): array => self::formatMessage($message),
            $messages,
        ));
    }

    /**
     * @param  array<string, mixed>  $message
     * @return array<string, mixed>
     */
    private static function formatMessage(array $message): array
    {
        if (($message['role'] ?? '') === 'tool') {
            return self::formatToolMessage($message);
        }

        $formatted = [
            'role' => (string) ($message['role'] ?? 'user'),
            'content' => self::formatContent($message['content'] ?? ''),
        ];

        if (! empty($message['tool_calls']) && is_array($message['tool_calls'])) {
            $formatted['tool_calls'] = array_values(array_map(
                fn (array $call): array => self::formatToolCall($call),
                $message['tool_calls'],
            ));
        }

        return $formatted;
    }

    /**
     * @param  array<string, mixed>  $message
     * @return array<string, mixed>
     */
    private static function formatToolMessage(array $message): array
    {
        $formatted = [
            'role' => 'tool',
            'content' => self::formatContent($message['content'] ?? ''),
        ];

        $name = trim((string) ($message['name'] ?? $message['tool_name'] ?? ''));

        if ($name !== '') {
            $formatted['name'] = $name;
        }

        return $formatted;
    }

    /**
     * @param  array<string, mixed>  $call
     * @return array<string, mixed>
     */
    private static function formatToolCall(array $call): array
    {
        $function = is_array($call['function'] ?? null) ? $call['function'] : [];

        return [
            'function' => [
                'name' => (string) ($function['name'] ?? ''),
                'arguments' => self::normalizeToolArguments($function['arguments'] ?? []),
            ],
        ];
    }

    /**
     * Ollama exige un objet JSON pour function.arguments, pas une chaîne sérialisée.
     *
     * @return array<string, mixed>
     */
    public static function normalizeToolArguments(mixed $arguments): array
    {
        while (is_string($arguments)) {
            $trimmed = trim($arguments);

            if ($trimmed === '' || $trimmed === '{}') {
                return [];
            }

            try {
                $decoded = json_decode($trimmed, true, 512, JSON_THROW_ON_ERROR);
            } catch (\JsonException) {
                return [];
            }

            if (is_array($decoded)) {
                return $decoded;
            }

            if (is_string($decoded)) {
                $arguments = $decoded;

                continue;
            }

            return [];
        }

        return is_array($arguments) ? $arguments : [];
    }

    private static function formatContent(mixed $content): string
    {
        $text = is_string($content)
            ? $content
            : (json_encode($content, JSON_UNESCAPED_UNICODE) ?: '');

        return self::truncateContent($text);
    }

    private static function truncateContent(string $content): string
    {
        if (mb_strlen($content) <= self::MAX_CONTENT_LENGTH) {
            return $content;
        }

        return mb_substr($content, 0, self::MAX_CONTENT_LENGTH).'… [truncated]';
    }
}
