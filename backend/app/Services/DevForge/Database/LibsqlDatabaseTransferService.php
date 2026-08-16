<?php

namespace App\Services\DevForge\Database;

use App\Models\StandaloneLibsql;
use RuntimeException;
use Symfony\Component\HttpKernel\Exception\HttpException;

class LibsqlDatabaseTransferService
{
    public function __construct(
        private readonly StandaloneDatabaseRuntimeGuard $runtimeGuard,
        private readonly DatabaseImportFinalizer $importFinalizer,
    ) {}

    private const SQLITE_RUNNER_IMAGE = 'alpine:3.20';

    /**
     * Legacy flat file path used by older imports (incompatible with modern sqld).
     */
    private const DB_PATH_LEGACY_FILE = '/var/lib/sqld/data.db';

    /**
     * Modern libsql-server layout (SQLD_DB_PATH=data.db is a directory).
     */
    private const DB_PATH_MODERN = '/var/lib/sqld/data.db/dbs/default/data';

    private const SQLITE_MAGIC_HEADER = "SQLite format 3\x00";

    /** Laravel `file` max rule unit (kilobytes) — 512 MiB. */
    public const MAX_UPLOAD_KILOBYTES = 524288;

    public const MAX_PAYLOAD_BYTES = self::MAX_UPLOAD_KILOBYTES * 1024;

    /** Soft threshold: warn UI / estimate longer SSH transfer. */
    public const WARN_PAYLOAD_BYTES = 20 * 1024 * 1024;

    /**
     * Base64 chunk size for remote printf|base64 append (SSH argv-safe fallback).
     * Preferred path is SCP (single round-trip via instant_scp).
     */
    public const REMOTE_CHUNK_CHARS = 72000;

    /** Retries per chunk when falling back to base64-in-shell transfer. */
    public const CHUNK_MAX_ATTEMPTS = 3;

    public const TRANSFER_METHOD_SCP = 'scp';

    public const TRANSFER_METHOD_CHUNKED = 'chunked_base64';

    public static function isSqliteDatabaseFile(string $payload): bool
    {
        return str_starts_with($payload, self::SQLITE_MAGIC_HEADER);
    }

    public static function estimateRemoteChunks(int $payloadBytes): int
    {
        if ($payloadBytes <= 0) {
            return 0;
        }

        $encodedLength = (int) ceil($payloadBytes / 3) * 4;

        return (int) max(1, (int) ceil($encodedLength / self::REMOTE_CHUNK_CHARS));
    }

    public static function isLargePayload(int $payloadBytes): bool
    {
        return $payloadBytes >= self::WARN_PAYLOAD_BYTES;
    }

    /**
     * @throws HttpException
     */
    public static function assertPayloadWithinLimits(string $payload): void
    {
        $bytes = strlen($payload);

        if ($bytes === 0) {
            throw new HttpException(422, 'Le fichier d’import est vide.');
        }

        if ($bytes > self::MAX_PAYLOAD_BYTES) {
            $maxMb = (int) (self::MAX_PAYLOAD_BYTES / 1024 / 1024);
            $actualMb = round($bytes / 1024 / 1024, 1);

            throw new HttpException(
                422,
                "Fichier trop volumineux ({$actualMb} Mo). Limite d’import : {$maxMb} Mo. "
                .'Pour les très grosses bases, préférez un dump SQL plus compact ou un transfert hors bande.',
            );
        }
    }

    /**
     * @param  array<string, mixed>  $result
     * @return array<string, mixed>
     */
    public static function enrichImportResult(array $result, int $payloadBytes, string $format, ?string $transferMethod = null): array
    {
        $chunks = self::estimateRemoteChunks($payloadBytes);
        $large = self::isLargePayload($payloadBytes);
        $method = $transferMethod ?? ($result['transfer_method'] ?? self::TRANSFER_METHOD_SCP);

        $result['downtime_required'] = true;
        $result['downtime_note'] = 'La base a été arrêtée pendant l’import puis redémarrée. Les applications connectées ont subi une coupure.';
        $result['payload_bytes'] = $payloadBytes;
        $result['estimated_transfer_chunks'] = $method === self::TRANSFER_METHOD_SCP ? 1 : $chunks;
        $result['large_payload'] = $large;
        $result['format'] = $format;
        $result['transfer_method'] = $method;

        if ($large) {
            $result['transfer_hint'] = $method === self::TRANSFER_METHOD_SCP
                ? 'Import volumineux : transfert SCP direct (un aller-retour). La coupure DB reste requise pour l’import.'
                : 'Import volumineux : repli SSH chunké (base64) — peut prendre plusieurs minutes et est sensible aux timeouts réseau.';
        }

        return $result;
    }

    public function export(StandaloneLibsql $database): string
    {
        $server = $database->destination->server;
        abort_unless($server->isFunctional(), 422, 'Le serveur n’est pas disponible.');

        $this->assertDatabaseFileExists($database);

        $command = $this->sqliteCommand(
            volumeName: $this->volumeName($database),
            readOnly: true,
            sqliteArgs: '.dump',
        );

        $output = trim((string) $this->runOnServer($server, [$command]));

        if ($output === '') {
            throw new HttpException(422, 'L’export SQL est vide. Vérifiez que la base contient un fichier data.db.');
        }

        return $output."\n";
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    public function queryJson(StandaloneLibsql $database, string $sql): array
    {
        $server = $database->destination->server;
        abort_unless($server->isFunctional(), 422, 'Le serveur n’est pas disponible.');

        if (! $this->databaseFileExists($database)) {
            return [];
        }

        $remoteSqlPath = '/tmp/devforge-libsql-query-'.$database->uuid.'-'.time().'-'.bin2hex(random_bytes(4)).'.sql';
        $this->writeRemoteFile($server, $remoteSqlPath, ".mode json\n".$sql);

        try {
            $volume = escapeshellarg($this->volumeName($database));
            $remoteSql = escapeshellarg($remoteSqlPath);
            $resolve = $this->resolveSqliteFileShellSnippet('/tmp/read/data.db');
            $command = "docker run --rm -v {$volume}:/var/lib/sqld:ro -v {$remoteSql}:/query.sql:ro "
                .escapeshellarg(self::SQLITE_RUNNER_IMAGE)
                ." sh -c 'apk add --no-cache sqlite >/dev/null 2>&1; "
                .'mkdir -p /tmp/read; '
                ."{$resolve}"
                ."sqlite3 /tmp/read/data.db < /query.sql'";

            $output = trim((string) $this->runRemoteProcess($server, [$command], 'Impossible d’exécuter la requête SQLite'));

            return self::decodeSqliteJsonOutput($output);
        } finally {
            $this->runOnServer($server, ['rm -f '.escapeshellarg($remoteSqlPath)], throwError: false);
        }
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    public static function decodeSqliteJsonOutput(string $output): array
    {
        $output = trim($output);

        if ($output === '') {
            return [];
        }

        if (str_starts_with($output, '[')) {
            $decoded = json_decode($output, true);

            if (! is_array($decoded)) {
                throw new HttpException(422, 'Impossible de lire les données SQLite.');
            }

            return $decoded;
        }

        $rows = [];

        foreach (explode("\n", $output) as $line) {
            $line = trim($line);

            if ($line === '') {
                continue;
            }

            $decoded = json_decode($line, true);

            if (! is_array($decoded)) {
                throw new HttpException(422, 'Impossible de lire les données SQLite.');
            }

            $rows[] = $decoded;
        }

        return $rows;
    }

    public function databaseFileExists(StandaloneLibsql $database): bool
    {
        $server = $database->destination->server;
        if (! $server->isFunctional()) {
            return false;
        }

        $volume = escapeshellarg($this->volumeName($database));
        $checkCommand = "docker run --rm -v {$volume}:/var/lib/sqld:ro "
            .escapeshellarg(self::SQLITE_RUNNER_IMAGE)
            ." sh -c 'test -f ".self::DB_PATH_MODERN.' || test -f '.self::DB_PATH_LEGACY_FILE."'";

        try {
            $this->runOnServer($server, [$checkCommand]);

            return true;
        } catch (\Throwable) {
            return false;
        }
    }

    /**
     * @return array<string, mixed>
     */
    public function importPayload(StandaloneLibsql $database, string $payload): array
    {
        self::assertPayloadWithinLimits($payload);

        if (self::isSqliteDatabaseFile($payload)) {
            return $this->importDatabaseFile($database, $payload);
        }

        return $this->importSql($database, $payload);
    }

    /**
     * Wipe all application data and recreate an empty SQLite database.
     *
     * @return array{reset: bool, restarted: bool, message: string}
     */
    public function resetEmpty(StandaloneLibsql $database): array
    {
        $server = $database->destination->server;
        abort_unless($server->isFunctional(), 422, 'Le serveur n’est pas disponible.');

        $this->runtimeGuard->stopForMaintenance($database);

        try {
            $volume = escapeshellarg($this->volumeName($database));
            $prepare = $this->prepareModernLayoutShellSnippet();
            $resetCommand = "docker run --rm -v {$volume}:/var/lib/sqld "
                .escapeshellarg(self::SQLITE_RUNNER_IMAGE)
                ." sh -c 'apk add --no-cache sqlite >/dev/null 2>&1; {$prepare}"
                .'sqlite3 '.self::DB_PATH_MODERN." \"PRAGMA user_version = 0;\"'";

            $this->runRemoteProcess(
                $server,
                [$resetCommand],
                'La réinitialisation de la base sur le serveur a échoué',
            );
        } catch (\Throwable $exception) {
            $this->runtimeGuard->ensureRunning($database);

            throw $exception;
        }

        $this->runtimeGuard->ensureRunning($database);

        return [
            'reset' => true,
            'restarted' => true,
            'message' => 'Base vidée et redémarrée. Les tables applicatives doivent être recréées (migration / premier démarrage).',
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function import(StandaloneLibsql $database, string $sql): array
    {
        return $this->importSql($database, $sql);
    }

    /**
     * @return array<string, mixed>
     */
    public function importSql(StandaloneLibsql $database, string $sql): array
    {
        $server = $database->destination->server;
        abort_unless($server->isFunctional(), 422, 'Le serveur n’est pas disponible.');

        $normalizedSql = trim($sql);
        if ($normalizedSql === '') {
            throw new HttpException(422, 'Le fichier SQL est vide.');
        }

        if (! str($normalizedSql)->lower()->contains(['create', 'insert', 'pragma', 'begin'])) {
            throw new HttpException(422, 'Le fichier ne ressemble pas à un export SQLite valide.');
        }

        self::assertPayloadWithinLimits($normalizedSql);
        $payloadBytes = strlen($normalizedSql."\n");

        $remoteSqlPath = '/tmp/devforge-libsql-import-'.$database->uuid.'-'.time().'.sql';
        $transferMethod = $this->writeRemoteFile($server, $remoteSqlPath, $normalizedSql."\n");

        $this->runtimeGuard->stopForMaintenance($database);

        try {
            $volume = escapeshellarg($this->volumeName($database));
            $remoteSql = escapeshellarg($remoteSqlPath);
            $prepare = $this->prepareModernLayoutShellSnippet();
            $importCommand = "docker run --rm -v {$volume}:/var/lib/sqld -v {$remoteSql}:/import.sql:ro "
                .escapeshellarg(self::SQLITE_RUNNER_IMAGE)
                ." sh -c 'apk add --no-cache sqlite >/dev/null 2>&1; {$prepare}"
                .'sqlite3 '.self::DB_PATH_MODERN." < /import.sql'";

            $this->runRemoteProcess(
                $server,
                [$importCommand],
                'L’import SQL sur le serveur a échoué (timeout possible sur les gros dumps)',
            );
        } finally {
            $this->runOnServer($server, ['rm -f '.escapeshellarg($remoteSqlPath)], throwError: false);
        }

        $result = $this->importFinalizer->finalize(
            $database,
            'sql',
            'Import SQL terminé. La base a été arrêtée puis redémarrée et est à nouveau active.',
        );

        return self::enrichImportResult($result, $payloadBytes, 'sql', $transferMethod);
    }

    /**
     * @return array<string, mixed>
     */
    public function importDatabaseFile(StandaloneLibsql $database, string $dbContents): array
    {
        $server = $database->destination->server;
        abort_unless($server->isFunctional(), 422, 'Le serveur n’est pas disponible.');

        if ($dbContents === '' || ! self::isSqliteDatabaseFile($dbContents)) {
            throw new HttpException(422, 'Le fichier .db n’est pas une base SQLite valide.');
        }

        self::assertPayloadWithinLimits($dbContents);
        $payloadBytes = strlen($dbContents);

        $remoteDbPath = '/tmp/devforge-libsql-import-'.$database->uuid.'-'.time().'.db';
        $transferMethod = $this->writeRemoteFile($server, $remoteDbPath, $dbContents);

        $this->runtimeGuard->stopForMaintenance($database);

        try {
            $volume = escapeshellarg($this->volumeName($database));
            $remoteDb = escapeshellarg($remoteDbPath);
            $prepare = $this->prepareModernLayoutShellSnippet();
            $importCommand = "docker run --rm -v {$volume}:/var/lib/sqld -v {$remoteDb}:/import.db:ro "
                .escapeshellarg(self::SQLITE_RUNNER_IMAGE)
                ." sh -c '{$prepare}cp /import.db ".self::DB_PATH_MODERN."'";

            $this->runRemoteProcess(
                $server,
                [$importCommand],
                'L’import du fichier .db sur le serveur a échoué (timeout possible sur les gros fichiers)',
            );
        } finally {
            $this->runOnServer($server, ['rm -f '.escapeshellarg($remoteDbPath)], throwError: false);
        }

        $result = $this->importFinalizer->finalize(
            $database,
            'db',
            'Import du fichier .db terminé. La base a été arrêtée puis redémarrée et est à nouveau active.',
        );

        return self::enrichImportResult($result, $payloadBytes, 'db', $transferMethod);
    }

    private function assertDatabaseFileExists(StandaloneLibsql $database): void
    {
        if (! $this->databaseFileExists($database)) {
            throw new HttpException(422, 'Aucun fichier data.db trouvé. Démarrez la base au moins une fois avant d’exporter.');
        }
    }

    private function sqliteCommand(string $volumeName, bool $readOnly, string $sqliteArgs): string
    {
        $volume = escapeshellarg($volumeName);
        $mount = $readOnly ? "{$volume}:/var/lib/sqld:ro" : "{$volume}:/var/lib/sqld";
        $resolve = $this->resolveSqliteFileShellSnippet('/tmp/export.db');

        return "docker run --rm -v {$mount} "
            .escapeshellarg(self::SQLITE_RUNNER_IMAGE)
            ." sh -c 'apk add --no-cache sqlite >/dev/null 2>&1; {$resolve}sqlite3 /tmp/export.db {$sqliteArgs}'";
    }

    /**
     * Prepare the modern sqld directory layout and clear previous namespace data.
     */
    private function prepareModernLayoutShellSnippet(): string
    {
        $modern = self::DB_PATH_MODERN;
        $legacy = self::DB_PATH_LEGACY_FILE;

        // If a legacy flat file exists at data.db, remove it so we can create the directory layout.
        // Then ensure dbs/default exists and wipe previous sqlite files for a clean import.
        return "if [ -f {$legacy} ]; then rm -f {$legacy} {$legacy}-wal {$legacy}-shm; fi; "
            .'mkdir -p /var/lib/sqld/data.db/dbs/default; '
            ."rm -f {$modern} {$modern}-wal {$modern}-shm; ";
    }

    /**
     * Copy the live sqlite file (modern layout preferred, legacy flat file fallback) to $target.
     */
    private function resolveSqliteFileShellSnippet(string $target): string
    {
        $modern = self::DB_PATH_MODERN;
        $legacy = self::DB_PATH_LEGACY_FILE;

        return "if [ -f {$modern} ]; then "
            ."cp {$modern} {$target}; "
            ."cp {$modern}-wal {$target}-wal 2>/dev/null || true; "
            ."cp {$modern}-shm {$target}-shm 2>/dev/null || true; "
            ."elif [ -f {$legacy} ]; then "
            ."cp {$legacy} {$target}; "
            ."cp {$legacy}-wal {$target}-wal 2>/dev/null || true; "
            ."cp {$legacy}-shm {$target}-shm 2>/dev/null || true; "
            .'else echo "sqlite database file not found" >&2; exit 1; fi; ';
    }

    private function volumeName(StandaloneLibsql $database): string
    {
        return 'libsql-data-'.$database->uuid;
    }

    /**
     * Prefer DevForge's instant_scp (single round-trip). Fall back to chunked base64 with retries.
     *
     * @param  (callable(int $done, int $total, string $method): void)|null  $onProgress
     * @return self::TRANSFER_METHOD_*
     */
    private function writeRemoteFile($server, string $remotePath, string $contents, ?callable $onProgress = null): string
    {
        $escapedPath = escapeshellarg($remotePath);
        $this->runOnServer($server, ["rm -f {$escapedPath}"], throwError: false);

        $localPath = tempnam(sys_get_temp_dir(), 'devforge-libsql-');
        if ($localPath === false) {
            return $this->writeRemoteFileChunked($server, $remotePath, $contents, $onProgress);
        }

        try {
            if (file_put_contents($localPath, $contents) === false) {
                throw new RuntimeException('Impossible d’écrire le fichier temporaire local pour le transfert SCP.');
            }

            try {
                instant_scp($localPath, $remotePath, $server);
                if ($onProgress !== null) {
                    $onProgress(1, 1, self::TRANSFER_METHOD_SCP);
                }

                return self::TRANSFER_METHOD_SCP;
            } catch (\Throwable) {
                // Non-root / tunnel / scp path issues → known DevForge fallback.
                return $this->writeRemoteFileChunked($server, $remotePath, $contents, $onProgress);
            }
        } finally {
            @unlink($localPath);
        }
    }

    /**
     * @param  (callable(int $done, int $total, string $method): void)|null  $onProgress
     * @return self::TRANSFER_METHOD_CHUNKED
     */
    private function writeRemoteFileChunked($server, string $remotePath, string $contents, ?callable $onProgress = null): string
    {
        $escapedPath = escapeshellarg($remotePath);
        $this->runOnServer($server, ["rm -f {$escapedPath}"], throwError: false);

        $chunks = str_split(base64_encode($contents), self::REMOTE_CHUNK_CHARS);
        $totalChunks = count($chunks);

        foreach ($chunks as $index => $chunk) {
            $encodedChunk = escapeshellarg($chunk);
            $chunkLabel = $totalChunks > 1
                ? ' (chunk '.($index + 1)."/{$totalChunks} — timeout possible sur gros fichiers)"
                : '';
            $lastException = null;

            for ($attempt = 1; $attempt <= self::CHUNK_MAX_ATTEMPTS; $attempt++) {
                try {
                    $this->runRemoteProcess(
                        $server,
                        ["printf %s {$encodedChunk} | base64 -d >> {$escapedPath}"],
                        'Impossible de transférer le dump vers le serveur'.$chunkLabel,
                    );
                    $lastException = null;
                    break;
                } catch (HttpException $exception) {
                    $lastException = $exception;
                    if ($attempt >= self::CHUNK_MAX_ATTEMPTS) {
                        throw $exception;
                    }
                }
            }

            if ($lastException !== null) {
                throw $lastException;
            }

            if ($onProgress !== null) {
                $onProgress($index + 1, $totalChunks, self::TRANSFER_METHOD_CHUNKED);
            }
        }

        return self::TRANSFER_METHOD_CHUNKED;
    }

    /**
     * @param  array<int, string>  $commands
     */
    private function runRemoteProcess($server, array $commands, string $message): ?string
    {
        try {
            return $this->runOnServer($server, $commands);
        } catch (RuntimeException $exception) {
            throw new HttpException(422, $message.': '.$exception->getMessage(), previous: $exception);
        }
    }

    /**
     * @param  array<int, string>  $commands
     */
    private function runOnServer($server, array $commands, bool $throwError = true): ?string
    {
        return instant_remote_process(
            $this->wrapCommandsForServer($server, $commands),
            $server,
            $throwError,
            no_sudo: true,
        );
    }

    /**
     * @param  array<int, string>  $commands
     * @return array<int, string>
     */
    private function wrapCommandsForServer($server, array $commands): array
    {
        return array_map(function (string $command) use ($server): string {
            $trimmed = trim($command);

            if ($server->isNonRoot() && ! str_starts_with($trimmed, 'sudo ')) {
                return "sudo {$trimmed}";
            }

            return $trimmed;
        }, $commands);
    }
}
