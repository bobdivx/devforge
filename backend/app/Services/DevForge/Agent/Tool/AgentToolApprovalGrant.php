<?php

namespace App\Services\DevForge\Agent\Tool;

use Illuminate\Support\Facades\Cache;

/**
 * One-shot grants so chat "Approve" can re-run a previously asked tool.
 * Also holds session-scoped plan-execution grants (plan-first mode).
 */
class AgentToolApprovalGrant
{
    private const TTL_SECONDS = 1800;

    private const PLAN_EXECUTION_KEY = '__plan_execution__';

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

    public static function grantForRun(int $runId, string $approvalKey): void
    {
        Cache::put(self::runCacheKey($runId, $approvalKey), true, self::TTL_SECONDS);
    }

    public static function consume(int $sessionId, string $approvalKey): bool
    {
        $key = self::cacheKey($sessionId, $approvalKey);

        if (! Cache::pull($key)) {
            return false;
        }

        return true;
    }

    public static function consumeForRun(int $runId, string $approvalKey): bool
    {
        return (bool) Cache::pull(self::runCacheKey($runId, $approvalKey));
    }

    public static function has(int $sessionId, string $approvalKey): bool
    {
        return (bool) Cache::get(self::cacheKey($sessionId, $approvalKey));
    }

    /**
     * After the user approves a propose_plan artefact, mutating tools are allowed
     * for this chat session until TTL expiry (hard-deny rules still apply).
     */
    public static function grantPlanExecution(int $sessionId): void
    {
        Cache::put(self::cacheKey($sessionId, self::PLAN_EXECUTION_KEY), true, self::TTL_SECONDS);
    }

    public static function hasPlanExecution(int $sessionId): bool
    {
        return self::has($sessionId, self::PLAN_EXECUTION_KEY);
    }

    public static function revokePlanExecution(int $sessionId): void
    {
        Cache::forget(self::cacheKey($sessionId, self::PLAN_EXECUTION_KEY));
    }

    /**
     * Session-scoped “always allow this tool” — not consumed on use.
     */
    public static function rememberTool(int $sessionId, string $toolName): void
    {
        Cache::put(self::cacheKey($sessionId, self::rememberKey($toolName)), true, self::TTL_SECONDS);
    }

    public static function hasRememberedTool(int $sessionId, string $toolName): bool
    {
        return self::has($sessionId, self::rememberKey($toolName));
    }

    private static function rememberKey(string $toolName): string
    {
        return '__remember_tool__:'.mb_strtolower(trim($toolName));
    }

    private static function cacheKey(int $sessionId, string $approvalKey): string
    {
        return "devforge:agent-tool-approval:{$sessionId}:{$approvalKey}";
    }

    private static function runCacheKey(int $runId, string $approvalKey): string
    {
        return "devforge:agent-tool-approval:run:{$runId}:{$approvalKey}";
    }
}
