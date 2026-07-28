<?php

namespace App\Services\DevForge\Agent;

/**
 * Catalogue des providers LLM supportés par DevForge.
 */
class LlmProviderRegistry
{
    /** @var list<string> */
    public const ALL = ['gemini', 'ollama', 'openai', 'openrouter', 'anthropic'];

    public static function isSupported(string $provider): bool
    {
        return in_array($provider, self::ALL, true);
    }

    public static function defaultBaseUrl(string $provider): ?string
    {
        return match ($provider) {
            'openai' => 'https://api.openai.com/v1',
            'openrouter' => 'https://openrouter.ai/api/v1',
            'anthropic' => 'https://api.anthropic.com/v1',
            'ollama' => null,
            'gemini' => null,
            default => null,
        };
    }

    public static function defaultModel(string $provider): string
    {
        return match ($provider) {
            'openai' => 'gpt-4o-mini',
            'openrouter' => 'openai/gpt-4o-mini',
            'anthropic' => 'claude-sonnet-4-20250514',
            'ollama' => LlmModelResolver::defaultOllamaModel(),
            default => LlmModelResolver::AUTO,
        };
    }

    public static function requiresApiKey(string $provider): bool
    {
        return in_array($provider, ['gemini', 'openai', 'openrouter', 'anthropic'], true);
    }

    public static function requiresBaseUrl(string $provider): bool
    {
        return $provider === 'ollama';
    }
}
