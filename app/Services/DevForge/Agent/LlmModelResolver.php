<?php

namespace App\Services\DevForge\Agent;

use App\Models\AiProviderConfig;

class LlmModelResolver
{
    public const AUTO = 'auto';

    /** @var array<int, string> */
    public const AUTO_GEMINI_PRIORITY = [
        'gemini-2.5-flash',
        'gemini-2.0-flash',
        'gemini-2.5-flash-lite',
        'gemini-2.0-flash-lite',
        'gemini-2.5-pro',
    ];

    /** @var array<int, string> */
    private const GEMINI_CHAT_BLOCKED_FRAGMENTS = [
        'embedding',
        'image',
        'audio',
        'tts',
        'computer-use',
        'live',
        'realtime',
        'aqa',
        'nano-banana',
        'robotics',
        'deep-research',
        'exp-',
        'customtools',
        'gemini-3.',
    ];

    private const DEFAULT_OLLAMA_MODEL = 'llama3.2';

    /** @var array<int, string> */
    public const AUTO_OLLAMA_PRIORITY = [
        'llama3.2:3b',
        'llama3.2',
        'llama3.1:8b',
        'llama3.1',
        'qwen2.5:7b',
        'qwen2.5:3b',
        'qwen2.5',
        'mistral',
        'mixtral',
        'gemma2:2b',
        'gemma2',
    ];

    /** @var array<int, string> */
    private const OLLAMA_TOOL_BLOCKED_FRAGMENTS = [
        'codegemma',
        'codellama',
        'deepseek-coder',
        'starcoder',
        'granite-code',
        'wizardcoder',
        'code:',
        'embed',
        'llava',
        'bakllava',
        'moondream',
        'vision',
        'nomic-embed',
    ];

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
        $compatible = array_values(array_filter(
            $available,
            fn (string $id): bool => self::isStableToolCallingGeminiModel($id),
        ));

        $ordered = [];

        foreach (self::AUTO_GEMINI_PRIORITY as $model) {
            if (in_array($model, $compatible, true)) {
                $ordered[] = $model;
            }
        }

        foreach ($compatible as $id) {
            if (! in_array($id, $ordered, true) && self::isStableToolCallingGeminiModel($id)) {
                $ordered[] = $id;
            }
        }

        return $ordered !== [] ? $ordered : self::AUTO_GEMINI_PRIORITY;
    }

    /**
     * Modèles Gemini 2.x stables pour appels d'outils multi-tours (sans thought_signature Gemini 3).
     */
    public static function isStableToolCallingGeminiModel(string $modelId): bool
    {
        if (! self::isChatCompatibleGeminiModel($modelId)) {
            return false;
        }

        $id = mb_strtolower(preg_replace('/^models\//i', '', trim($modelId)) ?? trim($modelId));

        return (bool) preg_match(
            '/^gemini-2\.(0|5)-(flash-lite|flash|pro)(?:-\d{3})?$/',
            $id,
        );
    }

    public static function isChatCompatibleGeminiModel(string $modelId): bool
    {
        $id = mb_strtolower(preg_replace('/^models\//i', '', trim($modelId)) ?? trim($modelId));

        if (! str_starts_with($id, 'gemini-')) {
            return false;
        }

        foreach (self::GEMINI_CHAT_BLOCKED_FRAGMENTS as $fragment) {
            if (str_contains($id, $fragment)) {
                return false;
            }
        }

        return (bool) preg_match(
            '/^gemini-[\d.]+-(flash-lite|flash|pro)(?:-preview)?(?:-[a-z0-9-]+)?$/i',
            $id,
        );
    }

    public static function defaultOllamaModel(): string
    {
        return self::DEFAULT_OLLAMA_MODEL;
    }

    /**
     * Modèles Ollama capables d'appeler des outils (agents DevForge).
     */
    public static function isToolCallingOllamaModel(string $modelId): bool
    {
        $id = mb_strtolower(trim($modelId));

        if ($id === '') {
            return false;
        }

        foreach (self::OLLAMA_TOOL_BLOCKED_FRAGMENTS as $fragment) {
            if (str_contains($id, $fragment)) {
                return false;
            }
        }

        return true;
    }

    /**
     * @param  array<int, string>  $available
     * @return array<int, string>
     */
    public static function prioritizeOllamaModelsForTools(array $available): array
    {
        $compatible = array_values(array_filter(
            $available,
            fn (string $id): bool => self::isToolCallingOllamaModel($id),
        ));

        $ordered = [];

        foreach (self::AUTO_OLLAMA_PRIORITY as $model) {
            foreach ($compatible as $id) {
                $lower = mb_strtolower($id);

                if ($lower === mb_strtolower($model) || str_starts_with($lower, mb_strtolower($model).':')) {
                    $ordered[] = $id;
                    break;
                }
            }
        }

        foreach ($compatible as $id) {
            if (! in_array($id, $ordered, true)) {
                $ordered[] = $id;
            }
        }

        return $ordered;
    }

    /**
     * @param  array<int, string>  $available
     */
    public static function pickBestOllamaModelForTools(array $available): ?string
    {
        $ordered = self::prioritizeOllamaModelsForTools($available);

        return $ordered[0] ?? null;
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
