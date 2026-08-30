<?php

namespace App\Services\DevForge\Agent;

/**
 * Parse la taille (milliards de paramètres) d'un id de modèle local (Ollama).
 * Sous 7B = trop petit pour les agents avec outils MCP.
 */
class LlmModelSize
{
    public const MIN_TOOL_PARAMS_B = 7.0;

    public static function warningMessage(): string
    {
        return 'Ce modèle est trop petit pour les agents avec outils (MCP). '
            .'Attendez-vous à des réponses vides ou absurdes ; '
            .'utilisez au moins un modèle coder 7B (ex. qwen2.5-coder:7b).';
    }

    public static function parseParamBillions(?string $model): ?float
    {
        $id = mb_strtolower(trim((string) $model));
        if ($id === '') {
            return null;
        }

        if (preg_match_all('/(\d+(?:\.\d+)?)b\b/i', $id, $matches, PREG_OFFSET_CAPTURE) < 1) {
            return null;
        }

        $values = [];
        foreach ($matches[1] as $match) {
            $digits = (string) $match[0];
            $offset = (int) $match[1];
            if ($offset > 0 && $id[$offset - 1] === 'x') {
                continue;
            }
            $values[] = (float) $digits;
        }

        if ($values === []) {
            return null;
        }

        return max($values);
    }

    public static function isTooSmallForTools(?string $model): bool
    {
        $id = mb_strtolower(trim((string) $model));
        if ($id === '' || $id === 'auto') {
            return false;
        }

        if (str_contains($id, 'tinyllama')
            || preg_match('/(?:^|[:\-_\/.])(tiny|mini)(?:[:\-_\/.]|$)/i', $id) === 1) {
            return true;
        }

        $billions = self::parseParamBillions($id);
        if ($billions === null) {
            return false;
        }

        return $billions < self::MIN_TOOL_PARAMS_B;
    }
}
