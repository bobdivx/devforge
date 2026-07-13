<?php

namespace App\Services\DevForge\Application;

use App\Models\Application;

class ApplicationContainerLogs
{
    /**
     * @return array<string, mixed>
     */
    public function fetch(Application $application, int $lines = 200): array
    {
        $lines = max(10, min($lines, 1000));
        $server = $application->destination?->server;

        if (! $server || ! $server->isFunctional()) {
            return $this->unavailable(
                reason: 'server_unavailable',
                message: 'Le serveur de déploiement n’est pas joignable.',
            );
        }

        $containers = getCurrentApplicationContainerStatus($server, $application->id);

        if ($containers->count() === 0) {
            return $this->unavailable(
                reason: 'not_running',
                message: 'Aucun conteneur actif pour cette application. Démarrez ou déployez l’application pour afficher les logs.',
            );
        }

        $container = $containers->first();
        $containerName = (string) data_get($container, 'Names', data_get($container, 'Name', ''));
        $containerId = (string) data_get($container, 'ID', '');
        $containerStatus = getContainerStatus($server, $containerName);

        if ($containerStatus !== 'running') {
            return [
                ...$this->unavailable(
                    reason: 'container_not_running',
                    message: 'Le conteneur n’est pas en cours d’exécution.',
                ),
                'container' => $containerName,
                'container_status' => $containerStatus,
            ];
        }

        $rawLogs = getContainerLogs($server, $containerId, $lines);

        return [
            'available' => true,
            'reason' => null,
            'message' => null,
            'container' => $containerName,
            'container_status' => $containerStatus,
            'line_count' => $lines,
            'items' => $this->parseLines($rawLogs),
        ];
    }

    /**
     * @return array<int, array{cursor: int, message: string}>
     */
    private function parseLines(string $rawLogs): array
    {
        if (blank($rawLogs)) {
            return [];
        }

        return collect(preg_split("/\r\n|\n|\r/", $rawLogs) ?: [])
            ->values()
            ->map(fn (string $line, int $index): array => [
                'cursor' => $index + 1,
                'message' => $line,
            ])
            ->all();
    }

    /**
     * @return array<string, mixed>
     */
    private function unavailable(string $reason, string $message): array
    {
        return [
            'available' => false,
            'reason' => $reason,
            'message' => $message,
            'container' => null,
            'container_status' => null,
            'line_count' => 0,
            'items' => [],
        ];
    }
}
