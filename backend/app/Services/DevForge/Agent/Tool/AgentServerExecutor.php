<?php

namespace App\Services\DevForge\Agent\Tool;

use App\Helpers\SshMultiplexingHelper;
use App\Models\Application;
use App\Models\Server;
use App\Models\Team;
use App\Services\DevForge\Core\CoreResourceCatalog;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Process;

/**
 * Exécution distante SSH pour agents — inspiré de forge-infra-client.ts (Forge).
 */
class AgentServerExecutor
{
    private const MAX_OUTPUT_BYTES = 65536;

    public function __construct(
        private readonly Team $team,
        private readonly CoreResourceCatalog $catalog,
        private readonly ?string $assignedResourceUuid = null,
    ) {}

    /**
     * @return array{success: bool, output?: string, error?: string, exit_code?: int}
     */
    public function execOnServer(string $serverUuid, string $command, int $timeout = 60): array
    {
        $server = $this->resolveServer($serverUuid);
        if ($server === null) {
            return ['success' => false, 'error' => "Serveur {$serverUuid} introuvable."];
        }

        if (! $server->isFunctional()) {
            return ['success' => false, 'error' => "Serveur {$server->name} non fonctionnel."];
        }

        if (! (bool) data_get($server, 'settings.is_terminal_enabled', true)) {
            return ['success' => false, 'error' => "Terminal désactivé sur le serveur {$server->name}."];
        }

        return $this->runSsh($server, $command, $timeout);
    }

    /**
     * @return array{success: bool, output?: string, error?: string}
     */
    public function readRemoteFile(string $serverUuid, string $path, int $maxBytes = 32768): array
    {
        $path = trim($path);
        if ($path === '' || str_contains($path, '..')) {
            return ['success' => false, 'error' => 'Chemin de fichier invalide.'];
        }

        $escapedPath = escapeshellarg($path);
        $command = "head -c {$maxBytes} {$escapedPath} 2>&1";

        $result = $this->execOnServer($serverUuid, $command, 30);
        if (! $result['success']) {
            return $result;
        }

        return [
            'success' => true,
            'output' => $result['output'] ?? '',
        ];
    }

    /**
     * @return array{success: bool, path?: string, bytes_written?: int, error?: string}
     */
    public function writeRemoteFile(string $serverUuid, string $path, string $content, int $maxBytes = 32768): array
    {
        $path = trim($path);
        if ($path === '' || str_contains($path, '..')) {
            return ['success' => false, 'error' => 'Chemin de fichier invalide.'];
        }

        if (strlen($content) > $maxBytes) {
            return ['success' => false, 'error' => "Contenu trop volumineux (max {$maxBytes} octets)."];
        }

        $encoded = base64_encode($content);
        $escapedPath = escapeshellarg($path);
        $command = 'echo '.escapeshellarg($encoded)." | base64 -d > {$escapedPath} 2>&1 && echo WRITE_OK";

        $result = $this->execOnServer($serverUuid, $command, 30);

        if (! $result['success']) {
            return $result;
        }

        if (! str_contains($result['output'] ?? '', 'WRITE_OK')) {
            return ['success' => false, 'error' => 'Écriture distante échouée.'];
        }

        return [
            'success' => true,
            'path' => $path,
            'bytes_written' => strlen($content),
        ];
    }

    /**
     * @return array{success: bool, output?: string, error?: string}
     */
    public function listRemoteDir(string $serverUuid, string $path = '.'): array
    {
        $path = trim($path) === '' ? '.' : trim($path);
        if (str_contains($path, '..')) {
            return ['success' => false, 'error' => 'Chemin de répertoire invalide.'];
        }

        $escapedPath = escapeshellarg($path);
        $command = "ls -la {$escapedPath} 2>&1";

        $result = $this->execOnServer($serverUuid, $command, 30);

        return $result['success']
            ? ['success' => true, 'output' => $result['output'] ?? '']
            : $result;
    }

    /**
     * @return array{success: bool, output?: string, error?: string, container?: string}
     */
    public function dockerLogs(string $serverUuid, string $container, int $lines = 100): array
    {
        $container = trim($container);
        if ($container === '' || ! preg_match('/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/', $container)) {
            return ['success' => false, 'error' => 'Nom de conteneur invalide.'];
        }

        $lines = max(1, min($lines, 500));
        $server = $this->resolveServer($serverUuid);
        if ($server === null) {
            return ['success' => false, 'error' => "Serveur {$serverUuid} introuvable."];
        }

        $command = $server->isSwarm()
            ? "docker service logs -n {$lines} {$container} 2>&1"
            : "docker logs -n {$lines} {$container} 2>&1";

        $result = $this->runSsh($server, $command, 60);

        return $result['success']
            ? ['success' => true, 'output' => $result['output'] ?? '', 'container' => $container]
            : $result;
    }

    /**
     * @return array{success: bool, server_uuid?: string, server_name?: string, error?: string}
     */
    public function resolveServerForApplication(string $applicationUuid): array
    {
        $application = $this->catalog->find($this->team, 'applications', $applicationUuid);
        if (! $application instanceof Application) {
            return ['success' => false, 'error' => "Application {$applicationUuid} introuvable."];
        }

        if (! $this->matchesAssignedResource($application)) {
            return ['success' => false, 'error' => 'Application hors du scope assigné à cet agent.'];
        }

        $server = $application->destination?->server;
        if (! $server instanceof Server) {
            return ['success' => false, 'error' => 'Aucun serveur associé à cette application.'];
        }

        return [
            'success' => true,
            'server_uuid' => $server->uuid,
            'server_name' => $server->name,
        ];
    }

    private function resolveServer(string $serverUuid): ?Server
    {
        $server = $this->catalog->find($this->team, 'servers', $serverUuid);

        if (! $server instanceof Server) {
            return null;
        }

        return $this->matchesAssignedResource($server) ? $server : null;
    }

    private function matchesAssignedResource(Model $resource): bool
    {
        if ($this->assignedResourceUuid === null || $this->assignedResourceUuid === '') {
            return true;
        }

        return (string) $resource->getAttribute('uuid') === $this->assignedResourceUuid;
    }

    /**
     * @return array{success: bool, output?: string, error?: string, exit_code?: int}
     */
    private function runSsh(Server $server, string $command, int $timeout): array
    {
        try {
            if ($server->settings?->force_disabled) {
                return ['success' => false, 'error' => 'Serveur désactivé.'];
            }

            SshMultiplexingHelper::ensureMultiplexedConnection($server);

            $commands = [$command];
            if ($server->isNonRoot()) {
                $commands = parseCommandsByLineForSudo(collect($commands), $server);
            }

            $commandString = implode("\n", $commands);
            $sshCommand = SshMultiplexingHelper::generateSshCommand($server, $commandString, false, $timeout);
            $process = Process::timeout($timeout)->run($sshCommand);

            $output = trim($process->output());
            $stderr = trim($process->errorOutput());
            $exitCode = $process->exitCode();

            if ($exitCode !== 0) {
                $error = $stderr !== '' ? $stderr : $output;

                return [
                    'success' => false,
                    'error' => mb_substr($error, 0, 2000),
                    'exit_code' => $exitCode,
                ];
            }

            $combined = $output;
            if ($stderr !== '') {
                $combined .= ($combined !== '' ? "\n" : '').$stderr;
            }

            return [
                'success' => true,
                'output' => mb_substr($combined, 0, self::MAX_OUTPUT_BYTES),
                'exit_code' => $exitCode,
            ];
        } catch (\Throwable $exception) {
            return [
                'success' => false,
                'error' => mb_substr($exception->getMessage(), 0, 2000),
            ];
        }
    }
}
