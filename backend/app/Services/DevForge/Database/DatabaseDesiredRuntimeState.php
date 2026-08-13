<?php

namespace App\Services\DevForge\Database;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Cache;

class DatabaseDesiredRuntimeState
{
    private const CACHE_PREFIX = 'devforge:database_keep_alive:desired:';

    public function markDesiredRunning(Model $database): void
    {
        Cache::put(
            $this->cacheKey((string) $database->uuid),
            true,
            now()->addSeconds($this->ttlSeconds()),
        );
    }

    public function markDesiredStopped(Model $database): void
    {
        Cache::put(
            $this->cacheKey((string) $database->uuid),
            false,
            now()->addSeconds($this->ttlSeconds()),
        );
    }

    /**
     * Explicit cache value: true = must run, false = stopped on purpose, null = unknown.
     */
    public function cachedDesired(Model $database): ?bool
    {
        $cached = Cache::get($this->cacheKey((string) $database->uuid));

        if ($cached === true) {
            return true;
        }

        if ($cached === false) {
            return false;
        }

        return null;
    }

    public function isDesiredRunning(Model $database): bool
    {
        $cached = $this->cachedDesired($database);

        if ($cached === true) {
            return true;
        }

        if ($cached === false) {
            return false;
        }

        return $this->isRunningStatus((string) ($database->status ?? ''));
    }

    private function cacheKey(string $uuid): string
    {
        return self::CACHE_PREFIX.$uuid;
    }

    private function ttlSeconds(): int
    {
        return max(3600, (int) config('devforge.database_keep_alive.desired_ttl_seconds', 60 * 60 * 24 * 30));
    }

    private function isRunningStatus(string $status): bool
    {
        return str($status)->before(':')->lower()->trim()->value() === 'running';
    }
}
