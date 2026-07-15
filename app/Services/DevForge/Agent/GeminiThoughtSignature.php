<?php

namespace App\Services\DevForge\Agent;

/**
 * Gestion des thought_signature Gemini (OpenAI compat) pour les appels d'outils multi-tours.
 *
 * @see https://ai.google.dev/gemini-api/docs/thought-signatures
 */
class GeminiThoughtSignature
{
    /** Valeur acceptée par l'API lorsque la signature d'origine est indisponible. */
    public const SKIP_VALIDATOR = 'skip_thought_signature_validator';

    /**
     * @param  array<string, mixed>  $toolCall
     * @return array<string, mixed>
     */
    public static function ensureOnToolCall(array $toolCall): array
    {
        $signature = $toolCall['extra_content']['google']['thought_signature'] ?? null;

        if (is_string($signature) && $signature !== '') {
            return $toolCall;
        }

        $toolCall['extra_content'] = [
            'google' => [
                'thought_signature' => self::SKIP_VALIDATOR,
            ],
        ];

        return $toolCall;
    }

    /**
     * @param  array<int, array<string, mixed>>  $toolCalls
     * @return array<int, array<string, mixed>>
     */
    public static function ensureOnToolCalls(array $toolCalls): array
    {
        return array_values(array_map(
            fn (array $call): array => self::ensureOnToolCall($call),
            $toolCalls,
        ));
    }
}
