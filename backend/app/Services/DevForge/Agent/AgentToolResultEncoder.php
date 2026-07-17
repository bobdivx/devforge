<?php

namespace App\Services\DevForge\Agent;

/**
 * Encode les résultats d'outils pour l'historique LLM avec limite de taille.
 */
class AgentToolResultEncoder
{
    public const MAX_BYTES = 12_000;

    public static function encode(mixed $result): string
    {
        $encoded = json_encode($result, JSON_UNESCAPED_UNICODE);

        if ($encoded === false) {
            return '{"error":"Impossible d\'encoder le résultat de l\'outil."}';
        }

        if (strlen($encoded) <= self::MAX_BYTES) {
            return $encoded;
        }

        return json_encode([
            'truncated' => true,
            'original_bytes' => strlen($encoded),
            'preview' => mb_substr($encoded, 0, self::MAX_BYTES - 512),
        ], JSON_UNESCAPED_UNICODE) ?: mb_substr($encoded, 0, self::MAX_BYTES).'…';
    }
}
