<?php

namespace App\Services\DevForge\Core;

class CoreResourceActionsResolver
{
    /**
     * @return array<int, string>
     */
    public function forResource(string $type, string $status): array
    {
        $primary = str($status)->before(':')->lower()->trim()->value();

        return match ($type) {
            'application' => $this->applicationActions($status, $primary),
            'service' => $this->serviceActions($status, $primary),
            'database' => $this->databaseActions(),
            default => [],
        };
    }

    /**
     * @return array<int, string>
     */
    private function applicationActions(string $status, string $primary): array
    {
        if ($this->isStopped($status, $primary)) {
            return ['deploy'];
        }

        return ['stop', 'restart', 'deploy'];
    }

    /**
     * @return array<int, string>
     */
    private function serviceActions(string $status, string $primary): array
    {
        if ($this->isStopped($status, $primary)) {
            return ['start'];
        }

        return ['stop', 'restart', 'deploy'];
    }

    /**
     * @return array<int, string>
     */
    private function databaseActions(): array
    {
        return ['restart'];
    }

    private function isStopped(string $status, string $primary): bool
    {
        return str($status)->startsWith('exited')
            || in_array($primary, ['stopped', 'dead'], true);
    }
}
