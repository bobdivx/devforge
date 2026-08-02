<?php

namespace App\Services\DevForge\Agent\Providers;

use App\Services\DevForge\Agent\Contracts\LlmProvider;
use App\Services\DevForge\Agent\Contracts\LlmResponse;
use App\Services\DevForge\Agent\LlmModelResolver;

class GeminiModelFailoverProvider implements LlmProvider
{
    private const MAX_AUTO_MODEL_ATTEMPTS = 4;

    /** @var array<int, string> */
    private const EXPLICIT_FALLBACK_MODELS = [
        'gemini-2.0-flash-lite',
        'gemini-2.5-flash-lite',
        'gemini-2.0-flash',
        'gemini-2.5-flash',
    ];

    /**
     * @param  array<int, string>|null  $autoModels
     */
    public function __construct(
        private readonly string $apiKey,
        private readonly string $model,
        private readonly ?string $baseUrl = null,
        private readonly ?\Closure $onModelSwitch = null,
        private readonly ?array $autoModels = null,
    ) {}

    /** {@inheritdoc} */
    public function chat(array $messages, array $tools = []): LlmResponse
    {
        $models = $this->modelsToTry();
        $lastException = null;
        $errors = [];
        $triedModels = [];

        foreach ($models as $index => $model) {
            $triedModels[] = $model;

            try {
                return (new GeminiProvider($this->apiKey, $model, $this->baseUrl))->chat($messages, $tools);
            } catch (\Throwable $exception) {
                $lastException = $exception;
                $errors[] = $exception->getMessage();

                // Auth = stop immédiat. Un 429 « exceeded quota » Gemini est souvent
                // par modèle (free tier) : on continue la liste pour Flash / Pro.
                if ($this->isAuthError($exception)) {
                    break;
                }

                if (! $this->isRetriable($exception) || $index === array_key_last($models)) {
                    break;
                }

                if ($this->onModelSwitch) {
                    ($this->onModelSwitch)($model, $models[$index + 1], $exception);
                }
            }
        }

        if ($lastException === null) {
            throw new \RuntimeException('Aucun modèle Gemini disponible.');
        }

        throw new \RuntimeException($this->formatFailureMessage($triedModels, $errors, $lastException), 0, $lastException);
    }

    public function testConnection(): bool
    {
        $model = $this->modelsToTry()[0] ?? LlmModelResolver::defaultAutoGeminiModels()[0];

        return (new GeminiProvider($this->apiKey, $model, $this->baseUrl))->testConnection();
    }

    /** @return array<int, string> */
    private function modelsToTry(): array
    {
        if (LlmModelResolver::isAuto($this->model)) {
            $models = $this->autoModels ?? LlmModelResolver::defaultAutoGeminiModels();

            return array_slice(array_values(array_unique($models)), 0, self::MAX_AUTO_MODEL_ATTEMPTS);
        }

        return array_values(array_unique([
            $this->normalizeModelId($this->model),
            ...self::EXPLICIT_FALLBACK_MODELS,
        ]));
    }

    /**
     * @param  array<int, string>  $models
     * @param  array<int, string>  $errors
     */
    private function formatFailureMessage(array $models, array $errors, \Throwable $lastException): string
    {
        $lastError = $lastException->getMessage();

        if ($this->allErrorsAreQuota($errors)) {
            return 'Gemini a refusé les modèles essayés ('.implode(', ', $models).') avec 429 RESOURCE_EXHAUSTED. '
                .'Souvent un rate-limit (RPM/TPM) ou un bucket free-tier du mauvais projet Google — '
                .'pas forcément « plus de crédit ». '
                .'Dernière erreur : '.$lastError.' '
                .'Vérifie la clé API / le projet dans AI Studio (Rate limit), '
                .'ou ajoute OpenRouter/OpenAI en secours.';
        }

        if (count($errors) > 1) {
            return 'Mode Auto Gemini : échec après '.count($models).' modèles chat ('.implode(', ', $models).'). '
                .'Dernière erreur : '.$lastError;
        }

        return $lastError;
    }

    /**
     * @param  array<int, string>  $errors
     */
    private function allErrorsAreQuota(array $errors): bool
    {
        if ($errors === []) {
            return false;
        }

        foreach ($errors as $error) {
            $lower = mb_strtolower($error);
            if (! str_contains($lower, '[429]') && ! str_contains($lower, 'quota') && ! str_contains($lower, 'rate limit')) {
                return false;
            }
        }

        return true;
    }

    private function isAuthError(\Throwable $exception): bool
    {
        $message = $exception->getMessage();

        return str_contains($message, '[401]') || str_contains($message, '[403]');
    }

    private function isRetriable(\Throwable $exception): bool
    {
        $message = mb_strtolower($exception->getMessage());

        return str_contains($message, '[429]')
            || str_contains($message, '[503]')
            || str_contains($message, '[500]')
            || str_contains($message, '[502]')
            || str_contains($message, '[504]')
            || str_contains($message, '[404]')
            || str_contains($message, '[400]')
            || str_contains($message, 'quota')
            || str_contains($message, 'rate limit')
            || str_contains($message, 'surcharg')
            || str_contains($message, 'high demand')
            || str_contains($message, 'not found')
            || str_contains($message, 'indisponible')
            || str_contains($message, 'non autoris');
    }

    private function normalizeModelId(string $model): string
    {
        return preg_replace('/^models\//i', '', trim($model)) ?? trim($model);
    }
}
