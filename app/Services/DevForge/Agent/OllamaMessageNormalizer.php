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

    /**
     * Condense un historique Gemini/OpenAI multi-tours pour un fallback Ollama sûr.
     *
     * @param  array<int, array<string, mixed>>  $messages
     * @return array<int, array<string, mixed>>
     */
    public static function compressForOllamaFallback(array $messages): array
    {
        $hasToolHistory = false;

        foreach ($messages as $message) {
            if (($message['role'] ?? '') === 'tool') {
                $hasToolHistory = true;
                break;
            }
        }

        if (! $hasToolHistory) {
            return self::formatMessages($messages);
        }

        $systemContent = '';
        $parts = [];

        foreach ($messages as $message) {
            $role = (string) ($message['role'] ?? '');

            if ($role === 'system') {
                $systemContent = self::formatContent($message['content'] ?? '');

                continue;
            }

            if ($role === 'user') {
                $parts[] = 'Utilisateur: '.self::formatContent($message['content'] ?? '');

                continue;
            }

            if ($role === 'assistant') {
                $text = trim(self::formatContent($message['content'] ?? ''));

                if ($text !== '') {
                    $parts[] = 'Assistant: '.$text;
                }

                foreach ($message['tool_calls'] ?? [] as $call) {
                    if (! is_array($call)) {
                        continue;
                    }

                    $function = is_array($call['function'] ?? null) ? $call['function'] : [];
                    $name = (string) ($function['name'] ?? 'outil');
                    $arguments = json_encode(
                        self::normalizeToolArguments($function['arguments'] ?? []),
                        JSON_UNESCAPED_UNICODE,
                    );

                    $parts[] = "Assistant (appel {$name}): {$arguments}";
                }

                continue;
            }

            if ($role === 'tool') {
                $name = (string) ($message['name'] ?? 'outil');
                $parts[] = "Résultat {$name}: ".self::formatContent($message['content'] ?? '');
            }
        }

        $compressed = [];

        if ($systemContent !== '') {
            $compressed[] = [
                'role' => 'system',
                'content' => $systemContent."\n\n[Historique condensé après bascule provider — continue avec le contexte ci-dessous.]",
            ];
        }

        $compressed[] = [
            'role' => 'user',
            'content' => implode("\n\n", $parts),
        ];

        return self::formatMessages($compressed);
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

        $trimmed = trim($content);

        if (str_starts_with($trimmed, '{') || str_starts_with($trimmed, '[')) {
            $wrapped = json_encode([
                'truncated' => true,
                'original_length' => mb_strlen($content),
                'preview' => mb_substr($content, 0, self::MAX_CONTENT_LENGTH - 256),
            ], JSON_UNESCAPED_UNICODE);

            if (is_string($wrapped)) {
                return $wrapped;
            }
        }

        return mb_substr($content, 0, self::MAX_CONTENT_LENGTH).'… [truncated]';
    }
}
