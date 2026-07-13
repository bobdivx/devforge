<?php

namespace App\Services\DevForge\Agent\Providers;

use App\Services\DevForge\Agent\Contracts\LlmProvider;
use App\Services\DevForge\Agent\Contracts\LlmResponse;

class ResilientLlmProvider implements LlmProvider
{
    public function __construct(
        private readonly LlmProvider $primary,
        private readonly LlmProvider $fallback,
        private readonly string $primaryLabel,
        private readonly string $fallbackLabel,
        private readonly ?\Closure $onFallback = null,
    ) {}

    /** {@inheritdoc} */
    public function chat(array $messages, array $tools = []): LlmResponse
    {
        try {
            return $this->primary->chat($messages, $tools);
        } catch (\Throwable $exception) {
            if (! $this->shouldFallback($exception)) {
                throw $exception;
            }

            if ($this->onFallback) {
                ($this->onFallback)($exception, $this->primaryLabel, $this->fallbackLabel);
            }

            return $this->fallback->chat($messages, $tools);
        }
    }

    public function testConnection(): bool
    {
        return $this->primary->testConnection() || $this->fallback->testConnection();
    }

    private function shouldFallback(\Throwable $exception): bool
    {
        $message = mb_strtolower($exception->getMessage());

        return str_contains($message, '[503]')
            || str_contains($message, '[429]')
            || str_contains($message, '[500]')
            || str_contains($message, 'surcharg')
            || str_contains($message, 'high demand')
            || str_contains($message, 'quota')
            || str_contains($message, 'rate limit')
            || str_contains($message, 'unavailable');
    }
}
