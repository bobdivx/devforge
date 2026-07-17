<?php

namespace App\Services\DevForge\Agent\Tool;

use Illuminate\Support\Facades\Cache;

/**
 * One-shot grants so chat "Approve" can re-run a previously asked tool.
 */
class AgentToolApprovalGrant
{
    private const TTL_SECONDS = 1800;

    public static function fingerprint(string $toolName, array $arguments = []): string
    {
        return hash(
            'sha256',
            $toolName.'|'.json_encode($arguments, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        );
    }

    public static function grant(int $sessionId, string $approvalKey): void
    {
        Cache::put(self::cacheKey($sessionId, $approvalKey), true, self::TTL_SECONDS);
    }

    public static function consume(int $sessionId, string $approvalKey): bool
    {
        $key = self::cacheKey($sessionId, $approvalKey);

        if (! Cache::pull($key)) {
            return false;
        }

        return true;
    }

    public static function has(int $sessionId, string $approvalKey): bool
    {
        return (bool) Cache::get(self::cacheKey($sessionId, $approvalKey));
    }

    private static function cacheKey(int $sessionId, string $approvalKey): string
    {
        return "devforge:agent-tool-approval:{$sessionId}:{$approvalKey}";
    }
}
