<?php

namespace App\Services\DevForge\Database;

use Illuminate\Database\Eloquent\Model;

class DatabaseContainerLogs
{
    /**
     * @return array<string, mixed>
     */
    public function fetch(Model $database, int $lines = 200): array
    {
        $lines = max(10, min($lines, 1000));
        $server = $database->destination?->server;

        if (! $server || ! $server->isFunctional()) {
            return $this->unavailable(
                reason: 'server_unavailable',
                message: 'Le serveur de déploiement n’est pas joignable.',
            );
        }

        $containerName = (string) data_get($database, 'uuid', '');

        if ($containerName === '') {
            return $this->unavailable(
                reason: 'not_running',
                message: 'Identifiant de conteneur introuvable pour cette base.',
            );
        }

        $containerStatus = getContainerStatus($server, $containerName);

        if ($containerStatus !== 'running') {
            return [
                ...$this->unavailable(
                    reason: 'not_running',
                    message: 'Aucun conteneur actif pour cette base. Démarrez la base pour afficher les logs.',
                ),
                'container' => $containerName,
                'container_status' => $containerStatus ?: null,
            ];
        }

        $rawLogs = getContainerLogs($server, $containerName, $lines);

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
    private function unavailable(string $reason, ?string $message): array
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
