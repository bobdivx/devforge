<?php

namespace App\Services\DevForge\Mcp;

use App\Models\AiAgentRun;

/**
 * Run fantôme pour réutiliser AgentToolkit depuis le MCP (pas de persistance).
 */
class McpEphemeralRun extends AiAgentRun
{
    public function appendLog(string $line): void
    {
        //
    }

    /** @param  array<string, mixed>  $options */
    public function saveQuietly(array $options = []): bool
    {
        return true;
    }

    /** @param  array<string, mixed>  $options */
    public function save(array $options = []): bool
    {
        return true;
    }

    /** @param  array<string, mixed>  $data */
    public function mergeMetadata(array $data): void
    {
        $this->metadata = array_merge($this->metadata ?? [], $data);
    }
}
