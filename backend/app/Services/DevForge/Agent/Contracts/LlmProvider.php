<?php

namespace App\Services\DevForge\Agent\Contracts;

interface LlmProvider
{
    /**
     * @param  array<array{role: string, content: string|array<mixed>}>  $messages
     * @param  array<array{name: string, description: string, parameters: array<mixed>}>  $tools
     */
    public function chat(array $messages, array $tools = []): LlmResponse;

    public function testConnection(): bool;
}
