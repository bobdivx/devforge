<?php

namespace App\Services\DevForge\Agent\Contracts;

class LlmResponse
{
    /**
     * @param  array<array{name: string, arguments: array<mixed>}>  $toolCalls
     */
    public function __construct(
        public readonly string $text,
        public readonly array $toolCalls,
        public readonly int $tokensUsed,
        public readonly bool $isFinished,
    ) {}

    public function hasToolCalls(): bool
    {
        return count($this->toolCalls) > 0;
    }
}
