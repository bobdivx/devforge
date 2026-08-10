<?php

namespace App\Services\DevForge\Application;

use App\Models\Application;
use Illuminate\Support\Facades\Cache;

class ApplicationDesiredRuntimeState
{
    private const CACHE_PREFIX = 'devforge:application_keep_alive:desired:';

    public function markDesiredRunning(Application $application): void
    {
        Cache::put(
            $this->cacheKey((string) $application->uuid),
            true,
            now()->addSeconds($this->ttlSeconds()),
        );
    }

    public function markDesiredStopped(Application $application): void
    {
        Cache::put(
            $this->cacheKey((string) $application->uuid),
            false,
            now()->addSeconds($this->ttlSeconds()),
        );
    }

    public function isDesiredRunning(Application $application): bool
    {
        $cached = Cache::get($this->cacheKey((string) $application->uuid));

        if ($cached === true) {
            return true;
        }

        if ($cached === false) {
            return false;
        }

        return $this->isRunningStatus((string) ($application->status ?? ''));
    }

    private function cacheKey(string $uuid): string
    {
        return self::CACHE_PREFIX.$uuid;
    }

    private function ttlSeconds(): int
    {
        return max(3600, (int) config('devforge.application_keep_alive.desired_ttl_seconds', 60 * 60 * 24 * 30));
    }

    private function isRunningStatus(string $status): bool
    {
        return str($status)->before(':')->lower()->trim()->value() === 'running';
    }
}
