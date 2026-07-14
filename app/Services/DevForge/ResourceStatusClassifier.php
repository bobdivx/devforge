<?php

namespace App\Services\DevForge;

class ResourceStatusClassifier
{
    public const TONE_SUCCESS = 'success';

    public const TONE_WARNING = 'warning';

    public const TONE_ERROR = 'error';

    public const TONE_NEUTRAL = 'neutral';

    public function tone(string $status): string
    {
        $normalized = strtolower(trim($status));
        if ($normalized === '') {
            return self::TONE_NEUTRAL;
        }

        [$primary, $health] = array_pad(explode(':', $normalized, 2), 2, null);

        if ($primary === 'running') {
            return $health === 'unhealthy' ? self::TONE_WARNING : self::TONE_SUCCESS;
        }

        if (in_array($primary, ['degraded', 'restarting', 'starting', 'created', 'paused'], true)) {
            return self::TONE_WARNING;
        }

        if (in_array($primary, ['exited', 'stopped', 'dead'], true)) {
            return self::TONE_ERROR;
        }

        if (str_contains($primary, 'fail') || in_array($primary, ['unavailable', 'error'], true)) {
            return self::TONE_ERROR;
        }

        if ($primary === 'unknown') {
            return self::TONE_NEUTRAL;
        }

        if (str_contains($primary, 'valid') || str_contains($primary, 'progress')) {
            return self::TONE_WARNING;
        }

        return self::TONE_NEUTRAL;
    }

    /**
     * @param  array<int, array<string, mixed>>  $resources
     * @return array{score: int, total_resources: int, running: int, degraded: int, stopped: int}
     */
    public function summarize(array $resources): array
    {
        $tones = collect($resources)->map(fn (array $resource): string => $this->tone((string) ($resource['status'] ?? 'unknown')));

        $running = $tones->filter(fn (string $tone): bool => $tone === self::TONE_SUCCESS)->count();
        $degraded = $tones->filter(fn (string $tone): bool => $tone === self::TONE_WARNING)->count();
        $stopped = $tones->filter(fn (string $tone): bool => $tone === self::TONE_ERROR)->count();
        $total = $tones->count();
        $score = $total > 0 ? (int) round(($running / $total) * 100) : 100;

        return [
            'score' => $score,
            'total_resources' => $total,
            'running' => $running,
            'degraded' => $degraded,
            'stopped' => $stopped,
        ];
    }
}
