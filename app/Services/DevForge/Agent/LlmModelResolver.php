<?php

namespace App\Services\DevForge\Agent;

use App\Models\AiProviderConfig;

class LlmModelResolver
{
    public const AUTO = 'auto';

    /** @var array<int, string> */
    public const AUTO_GEMINI_PRIORITY = [
        'gemini-2.0-flash-lite',
        'gemini-2.5-flash-lite',
        'gemini-2.0-flash',
        'gemini-2.5-flash',
    ];

    private const DEFAULT_OLLAMA_MODEL = 'llama3.2';

    public static function isAuto(?string $model): bool
    {
        $normalized = mb_strtolower(trim((string) $model));

        return $normalized === '' || $normalized === self::AUTO;
    }

    public static function normalizeStoredModel(?string $model): string
    {
        return self::isAuto($model) ? self::AUTO : trim((string) $model);
    }

    public static function resolvedModel(AiProviderConfig $config): string
    {
        if (! self::isAuto($config->model)) {
            return trim($config->model);
        }

        return self::AUTO;
    }

    /** @return array<int, string> */
    public static function defaultAutoGeminiModels(): array
    {
        return self::AUTO_GEMINI_PRIORITY;
    }

    /**
     * @param  array<int, string>  $available
     * @return array<int, string>
     */
    public static function prioritizeGeminiModels(array $available): array
    {
        $ordered = [];

        foreach (self::AUTO_GEMINI_PRIORITY as $model) {
            if (in_array($model, $available, true)) {
                $ordered[] = $model;
            }
        }

        foreach ($available as $id) {
            if (str_starts_with($id, 'gemini-') && ! in_array($id, $ordered, true)) {
                $ordered[] = $id;
            }
        }

        return $ordered !== [] ? $ordered : self::AUTO_GEMINI_PRIORITY;
    }

    public static function defaultOllamaModel(): string
    {
        return self::DEFAULT_OLLAMA_MODEL;
    }

    public static function displayLabel(AiProviderConfig $config): string
    {
        return self::isAuto($config->model) ? 'Auto' : trim($config->model);
    }

    public static function displayProviderLabel(AiProviderConfig $config): string
    {
        return "{$config->provider}/".self::displayLabel($config);
    }
}
