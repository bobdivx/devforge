<?php

namespace App\Services\DevForge\Agent\Providers;

use App\Services\DevForge\Agent\AgentEmptyAbsurdReply;
use App\Services\DevForge\Agent\Contracts\LlmProvider;
use App\Services\DevForge\Agent\Contracts\LlmResponse;
use App\Services\DevForge\Agent\OllamaMessageNormalizer;

class ResilientLlmProvider implements LlmProvider
{
    private bool $useFallback;

    public function __construct(
        private readonly LlmProvider $primary,
        private readonly LlmProvider $fallback,
        private readonly string $primaryLabel,
        private readonly string $fallbackLabel,
        private readonly ?\Closure $onFallback = null,
        bool $startWithFallback = false,
    ) {
        $this->useFallback = $startWithFallback;
    }

    /** {@inheritdoc} */
    public function chat(array $messages, array $tools = []): LlmResponse
    {
        if ($this->useFallback) {
            return $this->fallback->chat(
                $this->prepareFallbackMessages($messages),
                $tools,
            );
        }

        try {
            $response = $this->primary->chat($messages, $tools);
        } catch (\Throwable $exception) {
            if (! $this->shouldFallback($exception)) {
                throw $exception;
            }

            return $this->switchToFallback($exception, $messages, $tools);
        }

        if ($this->isEmptyOrAbsurdResponse($response, $messages)) {
            return $this->switchToFallback(
                new \RuntimeException('Empty or absurd LLM completion from '.$this->primaryLabel),
                $messages,
                $tools,
            );
        }

        return $response;
    }

    public function testConnection(): bool
    {
        return $this->primary->testConnection() || $this->fallback->testConnection();
    }

    /**
     * @param  array<int, array<string, mixed>>  $messages
     * @param  array<int, mixed>  $tools
     */
    private function switchToFallback(\Throwable $exception, array $messages, array $tools): LlmResponse
    {
        $this->useFallback = true;

        if ($this->onFallback) {
            ($this->onFallback)($exception, $this->primaryLabel, $this->fallbackLabel);
        }

        return $this->fallback->chat(
            $this->prepareFallbackMessages($messages),
            $tools,
        );
    }

    /**
     * @param  array<int, array<string, mixed>>  $messages
     */
    private function isEmptyOrAbsurdResponse(LlmResponse $response, array $messages): bool
    {
        $userMessage = '';
        for ($i = count($messages) - 1; $i >= 0; $i--) {
            if (($messages[$i]['role'] ?? '') === 'user') {
                $userMessage = (string) ($messages[$i]['content'] ?? '');
                break;
            }
        }

        return AgentEmptyAbsurdReply::isEmptyOrAbsurd(
            (string) ($response->text ?? ''),
            $response->hasToolCalls(),
            $userMessage,
        );
    }

    private function shouldFallback(\Throwable $exception): bool
    {
        $message = mb_strtolower($exception->getMessage());

        return str_contains($message, '[502]')
            || str_contains($message, '[503]')
            || str_contains($message, '[504]')
            || str_contains($message, '[429]')
            || str_contains($message, '[500]')
            || str_contains($message, '[404]')
            || str_contains($message, 'ollama api error')
            || str_contains($message, 'connection')
            || str_contains($message, 'timed out')
            || str_contains($message, 'timeout')
            || str_contains($message, 'curl error')
            || str_contains($message, 'mode auto gemini')
            || str_contains($message, 'quota gemini atteint')
            || str_contains($message, 'surcharg')
            || str_contains($message, 'high demand')
            || str_contains($message, 'quota')
            || str_contains($message, 'rate limit')
            || str_contains($message, 'unavailable')
            || str_contains($message, 'indisponible');
    }

    /**
     * @param  array<int, array<string, mixed>>  $messages
     * @return array<int, array<string, mixed>>
     */
    private function prepareFallbackMessages(array $messages): array
    {
        if ($this->fallback instanceof OllamaProvider) {
            return OllamaMessageNormalizer::compressForOllamaFallback($messages);
        }

        return $messages;
    }
}
