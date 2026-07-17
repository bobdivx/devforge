<?php

namespace App\Services\DevForge\Readiness;

use App\Models\Application;

class HealthCheckBootstrapper
{
    /**
     * Enable a sensible Docker HTTP healthcheck when none is configured.
     *
     * @return array{changed: bool, path: string, port: string}
     */
    public function ensureEnabled(Application $application): array
    {
        $port = $this->resolvePort($application);
        $path = filled($application->health_check_path)
            ? (string) $application->health_check_path
            : '/';

        $changed = false;

        if (! $application->health_check_enabled) {
            $application->health_check_enabled = true;
            $changed = true;
        }

        if (($application->health_check_type ?? 'http') !== 'http') {
            $application->health_check_type = 'http';
            $changed = true;
        }

        if (! filled($application->health_check_path)) {
            $application->health_check_path = $path;
            $changed = true;
        }

        if (! filled($application->health_check_port)) {
            $application->health_check_port = $port;
            $changed = true;
        }

        if ($changed) {
            $application->save();
        }

        return [
            'changed' => $changed,
            'path' => (string) $application->health_check_path,
            'port' => (string) ($application->health_check_port ?: $port),
        ];
    }

    private function resolvePort(Application $application): string
    {
        $ports = $application->ports_exposes_array;
        $first = $ports[0] ?? null;

        if (is_numeric($first) && (int) $first > 0) {
            return (string) (int) $first;
        }

        return '80';
    }
}
