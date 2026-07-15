<?php

namespace App\Services\DevForge\Server;

use App\Models\Server;
use App\Models\Team;
use App\Services\DevForge\Agent\Tool\AgentServerExecutor;
use App\Services\DevForge\Core\CoreResourceCatalog;
use Illuminate\Validation\ValidationException;

class ServerFilesystemService
{
    private const READ_MAX_BYTES = 65536;

    private const WRITE_MAX_BYTES = 32768;

    private const SEARCH_MAX_LINES = 200;

    public function __construct(
        private readonly ServerStorageService $storageService,
        private readonly CoreResourceCatalog $catalog,
    ) {}

    public function findForTeam(Team $team, string $serverUuid): Server
    {
        return $this->storageService->findForTeam($team, $serverUuid);
    }

    /**
     * @return array<string, mixed>
     */
    public function listDirectory(Team $team, Server $server, ?string $path = null): array
    {
        $this->assertTerminalEnabled($server);

        $directory = ServerPathValidator::normalizeDirectory($path);
        $executor = $this->executor($team);
        $result = $executor->listRemoteDir($server->uuid, $directory);

        if (! $result['success']) {
            return $this->failure($result['error'] ?? 'Impossible de lister le répertoire.');
        }

        $entries = ServerRemoteListingParser::parse($result['output'] ?? '');

        return [
            'path' => $directory,
            'parent_path' => $this->parentPath($directory),
            'entries' => $entries,
            'entry_count' => count($entries),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function readFile(Team $team, Server $server, string $path): array
    {
        $this->assertTerminalEnabled($server);

        $filePath = ServerPathValidator::normalize($path);
        $executor = $this->executor($team);
        $result = $executor->readRemoteFile($server->uuid, $filePath, self::READ_MAX_BYTES);

        if (! $result['success']) {
            return $this->failure($result['error'] ?? 'Impossible de lire le fichier.');
        }

        $content = $result['output'] ?? '';
        $truncated = strlen($content) >= self::READ_MAX_BYTES;

        return [
            'path' => $filePath,
            'content' => $content,
            'size' => strlen($content),
            'truncated' => $truncated,
            'max_bytes' => self::READ_MAX_BYTES,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function writeFile(Team $team, Server $server, string $path, string $content): array
    {
        $this->assertTerminalEnabled($server);

        $filePath = ServerPathValidator::normalize($path);

        if (strlen($content) > self::WRITE_MAX_BYTES) {
            throw ValidationException::withMessages([
                'content' => 'Contenu trop volumineux (max '.self::WRITE_MAX_BYTES.' octets).',
            ]);
        }

        $executor = $this->executor($team);
        $result = $executor->writeRemoteFile($server->uuid, $filePath, $content, self::WRITE_MAX_BYTES);

        if (! $result['success']) {
            return $this->failure($result['error'] ?? 'Impossible d\'écrire le fichier.');
        }

        return [
            'path' => $filePath,
            'bytes_written' => $result['bytes_written'] ?? strlen($content),
            'message' => 'Fichier enregistré.',
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function search(
        Team $team,
        Server $server,
        string $pattern,
        string $mode = 'name',
        ?string $path = null,
    ): array {
        $this->assertTerminalEnabled($server);

        $pattern = trim($pattern);
        if ($pattern === '') {
            throw ValidationException::withMessages([
                'pattern' => 'Le motif de recherche est requis.',
            ]);
        }

        $root = ServerPathValidator::normalizeDirectory($path);
        $executor = $this->executor($team);

        $escapedRoot = escapeshellarg($root);
        $escapedPattern = escapeshellarg($pattern);

        $command = $mode === 'content'
            ? "cd {$escapedRoot} && grep -rIn --exclude-dir=node_modules --exclude-dir=.git {$escapedPattern} . 2>/dev/null | head -".self::SEARCH_MAX_LINES
            : "find {$escapedRoot} -name {$escapedPattern} -not -path '*/node_modules/*' -not -path '*/.git/*' 2>/dev/null | head -".self::SEARCH_MAX_LINES;

        $result = $executor->execOnServer($server->uuid, $command, 45);

        if (! $result['success']) {
            return $this->failure($result['error'] ?? 'Recherche impossible.');
        }

        $lines = array_values(array_filter(
            explode("\n", trim($result['output'] ?? '')),
            fn (string $line): bool => $line !== '',
        ));

        return [
            'path' => $root,
            'pattern' => $pattern,
            'mode' => $mode,
            'results' => $lines,
            'result_count' => count($lines),
            'truncated' => count($lines) >= self::SEARCH_MAX_LINES,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function meta(): array
    {
        return [
            'default_path' => ServerPathValidator::DEFAULT_ROOT,
            'read_max_bytes' => self::READ_MAX_BYTES,
            'write_max_bytes' => self::WRITE_MAX_BYTES,
        ];
    }

    private function executor(Team $team): AgentServerExecutor
    {
        return new AgentServerExecutor(
            team: $team,
            catalog: $this->catalog,
        );
    }

    private function assertTerminalEnabled(Server $server): void
    {
        if (! (bool) data_get($server, 'settings.is_terminal_enabled', true)) {
            throw ValidationException::withMessages([
                'server' => 'Terminal désactivé sur ce serveur.',
            ]);
        }
    }

    private function parentPath(string $directory): ?string
    {
        if ($directory === '/') {
            return null;
        }

        $parent = dirname($directory);

        return $parent === '.' ? '/' : $parent;
    }

    /**
     * @return array{success: false, error: string}
     */
    private function failure(string $error): array
    {
        return [
            'success' => false,
            'error' => $error,
        ];
    }
}
