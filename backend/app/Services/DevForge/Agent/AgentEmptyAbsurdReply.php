<?php

namespace App\Services\DevForge\Agent;

/**
 * Détecte les finales assistant vides ou absurdes (petits modèles Ollama + tools/MCP,
 * ou réponses cloud vides type Gemini / OpenRouter).
 */
class AgentEmptyAbsurdReply
{
    private const ABSURD_TOKENS = [
        'unfavored', 'unfavourited', 'unfavourite', 'unfavorited',
        'favored', 'favoured', 'favourite', 'favorite', 'undefined', 'null', 'none',
    ];

    private const CLOUD_PROVIDERS = ['gemini', 'openai', 'openrouter', 'anthropic'];

    public static function isEmpty(string $text): bool
    {
        return trim($text) === '';
    }

    public static function isAbsurdToken(string $text): bool
    {
        $normalized = mb_strtolower(trim($text));
        $normalized = trim($normalized, " \t\n\r\0\x0B.,!?;:'\"`()[]{}");
        return $normalized !== '' && in_array($normalized, self::ABSURD_TOKENS, true);
    }

    public static function looksFrench(string $text): bool
    {
        if (preg_match('/[àâäéèêëïîôùûüçœæ]/iu', $text) === 1) {
            return true;
        }
        return (bool) preg_match(
            '/\b(le|la|les|un|une|des|je|tu|il|nous|vous|ils|est|sont|pas|pour|avec|dans|sur|ce|cette|qui|que|de|du|et|ou|bonjour|salut|voici|merci|oui|non|d[ée]ploiement|corrige|statut|application|sant[ée]|relance)\b/iu',
            $text,
        );
    }

    public static function isShortNonFrenchGibberish(string $text): bool
    {
        $trimmed = trim($text);
        if ($trimmed === '' || self::looksFrench($trimmed)) {
            return false;
        }
        if (mb_strlen($trimmed) > 40) {
            return false;
        }
        $words = preg_split('/\s+/u', $trimmed) ?: [];
        if (count($words) === 0 || count($words) > 3) {
            return false;
        }
        foreach ($words as $word) {
            $token = trim($word, ".,!?;:'\"`()[]{}");
            if ($token === '' || preg_match('/^[A-Za-z]{1,24}$/', $token) !== 1) {
                return false;
            }
        }
        return true;
    }

    public static function isEmptyOrAbsurd(string $text, bool $hasToolCalls, string $userMessage = ''): bool
    {
        if ($hasToolCalls) {
            return false;
        }
        if (self::isEmpty($text) || self::isAbsurdToken($text)) {
            return true;
        }
        $needsTools = $userMessage !== '' && AgentChatStatusDirectives::requiresChatTools($userMessage);
        return $needsTools && self::isShortNonFrenchGibberish($text);
    }

    public static function historyContent(string $text): string
    {
        if (self::isEmpty($text) || self::isAbsurdToken($text) || self::isShortNonFrenchGibberish($text)) {
            return '…';
        }
        return $text;
    }

    public static function isCloudProvider(?string $provider, ?string $model = null, ?string $hostHint = null): bool
    {
        $provider = mb_strtolower(trim((string) $provider));
        if (in_array($provider, self::CLOUD_PROVIDERS, true)) {
            return true;
        }
        $haystack = mb_strtolower(trim((string) $model).' '.trim((string) $hostHint));
        if ($haystack === ' ') {
            return false;
        }
        return str_contains($haystack, 'generativelanguage.googleapis.com')
            || str_contains($haystack, 'googleapis.com')
            || str_contains($haystack, 'openrouter.ai')
            || str_contains($haystack, 'api.openai.com')
            || str_contains($haystack, 'api.anthropic.com')
            || str_contains($haystack, 'gemini-')
            || str_contains($haystack, 'gpt-')
            || str_contains($haystack, 'claude');
    }

    public static function isEmptyCompletionFailure(string $message): bool
    {
        $lower = mb_strtolower($message);
        return (str_contains($lower, 'no message or tool call') && str_contains($lower, 'empty'))
            || str_contains($lower, 'response contained no message')
            || str_contains($lower, 'no content provided')
            || str_contains($lower, 'réponse vide')
            || str_contains($lower, 'reponse vide');
    }

    public static function userFacingFailureMessage(?string $model = null, ?string $provider = null, ?string $hostHint = null): string
    {
        if (self::isCloudProvider($provider, $model, $hostHint)) {
            $label = is_string($model) && trim($model) !== '' ? ' « '.trim($model).' »' : '';
            return 'Le fournisseur LLM cloud'.$label.' a renvoyé une réponse vide (sans message ni appel d’outil).'
                .' Tous les providers configurés ont été essayés sans succès.'
                .' Réessayez, ou basculez manuellement vers Ollama (Demeter / qwen2.5-coder:7b) ou un autre provider.';
        }
        $hint = is_string($model) && trim($model) !== ''
            ? ' Le modèle « '.trim($model).' » est trop petit pour les outils MCP.'
            : ' Le petit modèle local n’a pas pu produire une réponse utilisable (souvent qwen2.5:3b + outils MCP).';
        return 'Le petit modèle a échoué (réponse vide ou absurde).'.$hint
            .' Réessayez avec un modèle plus grand (qwen2.5:7b / 14b, llama3.1:8b, ou Demeter / RTX 3090).';
    }
}
