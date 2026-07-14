<?php

namespace App\Services\DevForge\Agent\Providers;

use App\Services\DevForge\Agent\Contracts\LlmProvider;
use App\Services\DevForge\Agent\Contracts\LlmResponse;
use App\Services\DevForge\Agent\LlmModelResolver;

class GeminiModelFailoverProvider implements LlmProvider
{
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

        foreach ($models as $index => $model) {
            try {
                return (new GeminiProvider($this->apiKey, $model, $this->baseUrl))->chat($messages, $tools);
            } catch (\Throwable $exception) {
                $lastException = $exception;
                $errors[] = $exception->getMessage();

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

        if (count($errors) > 1) {
            throw new \RuntimeException(
                'Mode Auto Gemini : aucun modèle disponible. Modèles essayés : '
                .implode(', ', $models).'. Détails : '.implode(' | ', $errors),
                0,
                $lastException,
            );
        }

        throw $lastException;
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

            return array_values(array_unique($models));
        }

        return array_values(array_unique([
            $this->normalizeModelId($this->model),
            ...self::EXPLICIT_FALLBACK_MODELS,
        ]));
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
