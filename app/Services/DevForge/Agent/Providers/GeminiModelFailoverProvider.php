<?php

namespace App\Services\DevForge\Agent\Providers;

use App\Services\DevForge\Agent\Contracts\LlmProvider;
use App\Services\DevForge\Agent\Contracts\LlmResponse;

class GeminiModelFailoverProvider implements LlmProvider
{
    /** @var array<int, string> */
    private const FALLBACK_MODELS = [
        'gemini-2.5-flash',
        'gemini-2.0-flash',
        'gemini-2.5-flash-lite',
        'gemini-2.0-flash-lite',
    ];

    public function __construct(
        private readonly string $apiKey,
        private readonly string $model,
        private readonly ?string $baseUrl = null,
        private readonly ?\Closure $onModelSwitch = null,
    ) {}

    /** {@inheritdoc} */
    public function chat(array $messages, array $tools = []): LlmResponse
    {
        $models = array_values(array_unique([
            $this->normalizeModelId($this->model),
            ...self::FALLBACK_MODELS,
        ]));

        $lastException = null;

        foreach ($models as $index => $model) {
            try {
                return (new GeminiProvider($this->apiKey, $model, $this->baseUrl))->chat($messages, $tools);
            } catch (\Throwable $exception) {
                $lastException = $exception;

                if (! $this->isRetriable($exception) || $index === array_key_last($models)) {
                    throw $exception;
                }

                if ($this->onModelSwitch) {
                    ($this->onModelSwitch)($model, $models[$index + 1], $exception);
                }
            }
        }

        throw $lastException ?? new \RuntimeException('Aucun modèle Gemini disponible.');
    }

    public function testConnection(): bool
    {
        return (new GeminiProvider($this->apiKey, $this->model, $this->baseUrl))->testConnection();
    }

    private function isRetriable(\Throwable $exception): bool
    {
        $message = mb_strtolower($exception->getMessage());

        return str_contains($message, '[429]')
            || str_contains($message, '[503]')
            || str_contains($message, '[500]')
            || str_contains($message, '[502]')
            || str_contains($message, '[504]')
            || str_contains($message, 'quota')
            || str_contains($message, 'rate limit')
            || str_contains($message, 'surcharg')
            || str_contains($message, 'high demand');
    }

    private function normalizeModelId(string $model): string
    {
        return preg_replace('/^models\//i', '', trim($model)) ?? trim($model);
    }
}
