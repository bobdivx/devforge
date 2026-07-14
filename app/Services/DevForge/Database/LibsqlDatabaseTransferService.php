<?php

namespace App\Services\DevForge\Database;

use App\Actions\Database\StartDatabase;
use App\Actions\Database\StopDatabase;
use App\Models\StandaloneLibsql;
use RuntimeException;
use Symfony\Component\HttpKernel\Exception\HttpException;

class LibsqlDatabaseTransferService
{
    private const SQLITE_RUNNER_IMAGE = 'alpine:3.20';

    private const DB_RELATIVE_PATH = '/var/lib/sqld/data.db';

    private const SQLITE_MAGIC_HEADER = "SQLite format 3\x00";

    public static function isSqliteDatabaseFile(string $payload): bool
    {
        return str_starts_with($payload, self::SQLITE_MAGIC_HEADER);
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
            $command = "docker run --rm -v {$volume}:/var/lib/sqld:ro -v {$remoteSql}:/query.sql:ro "
                .escapeshellarg(self::SQLITE_RUNNER_IMAGE)
                ." sh -c 'apk add --no-cache sqlite >/dev/null 2>&1; "
                ."mkdir -p /tmp/read; "
                ."cp /var/lib/sqld/data.db /tmp/read/data.db; "
                ."cp /var/lib/sqld/data.db-wal /tmp/read/data.db-wal 2>/dev/null || true; "
                ."cp /var/lib/sqld/data.db-shm /tmp/read/data.db-shm 2>/dev/null || true; "
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
            ." sh -c 'test -f /var/lib/sqld/data.db'";

        try {
            $this->runOnServer($server, [$checkCommand]);

            return true;
        } catch (\Throwable) {
            return false;
        }
    }

    /**
     * @return array{restarted: bool, message: string, format: string}
     */
    public function importPayload(StandaloneLibsql $database, string $payload): array
    {
        if (self::isSqliteDatabaseFile($payload)) {
            return $this->importDatabaseFile($database, $payload);
        }

        return $this->importSql($database, $payload);
    }

    /**
     * @return array{restarted: bool, message: string, format: string}
     */
    public function import(StandaloneLibsql $database, string $sql): array
    {
        return $this->importSql($database, $sql);
    }

    /**
     * @return array{restarted: bool, message: string, format: string}
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

        $remoteSqlPath = '/tmp/devforge-libsql-import-'.$database->uuid.'-'.time().'.sql';
        $this->writeRemoteFile($server, $remoteSqlPath, $normalizedSql."\n");

        $wasRunning = $database->isRunning();
        if ($wasRunning) {
            StopDatabase::run($database, dockerCleanup: false);
        }

        try {
            $volume = escapeshellarg($this->volumeName($database));
            $remoteSql = escapeshellarg($remoteSqlPath);
            $importCommand = "docker run --rm -v {$volume}:/var/lib/sqld -v {$remoteSql}:/import.sql:ro "
                .escapeshellarg(self::SQLITE_RUNNER_IMAGE)
                ." sh -c 'apk add --no-cache sqlite >/dev/null 2>&1; rm -f /var/lib/sqld/data.db /var/lib/sqld/data.db-wal /var/lib/sqld/data.db-shm; sqlite3 /var/lib/sqld/data.db < /import.sql'";

            $this->runRemoteProcess($server, [$importCommand], 'L’import SQL sur le serveur a échoué');
        } finally {
            $this->runOnServer($server, ['rm -f '.escapeshellarg($remoteSqlPath)], throwError: false);
        }

        StartDatabase::run($database);

        return [
            'restarted' => true,
            'format' => 'sql',
            'message' => 'Import SQL terminé. La base redémarre.',
        ];
    }

    /**
     * @return array{restarted: bool, message: string, format: string}
     */
    public function importDatabaseFile(StandaloneLibsql $database, string $dbContents): array
    {
        $server = $database->destination->server;
        abort_unless($server->isFunctional(), 422, 'Le serveur n’est pas disponible.');

        if ($dbContents === '' || ! self::isSqliteDatabaseFile($dbContents)) {
            throw new HttpException(422, 'Le fichier .db n’est pas une base SQLite valide.');
        }

        $remoteDbPath = '/tmp/devforge-libsql-import-'.$database->uuid.'-'.time().'.db';
        $this->writeRemoteFile($server, $remoteDbPath, $dbContents);

        $wasRunning = $database->isRunning();
        if ($wasRunning) {
            StopDatabase::run($database, dockerCleanup: false);
        }

        try {
            $volume = escapeshellarg($this->volumeName($database));
            $remoteDb = escapeshellarg($remoteDbPath);
            $importCommand = "docker run --rm -v {$volume}:/var/lib/sqld -v {$remoteDb}:/import.db:ro "
                .escapeshellarg(self::SQLITE_RUNNER_IMAGE)
                ." sh -c 'rm -f /var/lib/sqld/data.db /var/lib/sqld/data.db-wal /var/lib/sqld/data.db-shm; cp /import.db /var/lib/sqld/data.db'";

            $this->runRemoteProcess($server, [$importCommand], 'L’import du fichier .db sur le serveur a échoué');
        } finally {
            $this->runOnServer($server, ['rm -f '.escapeshellarg($remoteDbPath)], throwError: false);
        }

        StartDatabase::run($database);

        return [
            'restarted' => true,
            'format' => 'db',
            'message' => 'Import du fichier .db terminé. La base redémarre.',
        ];
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
        $dbPath = self::DB_RELATIVE_PATH;

        return "docker run --rm -v {$mount} "
            .escapeshellarg(self::SQLITE_RUNNER_IMAGE)
            ." sh -c 'apk add --no-cache sqlite >/dev/null 2>&1; sqlite3 {$dbPath} {$sqliteArgs}'";
    }

    private function volumeName(StandaloneLibsql $database): string
    {
        return 'libsql-data-'.$database->uuid;
    }

    private function writeRemoteFile($server, string $remotePath, string $contents): void
    {
        $escapedPath = escapeshellarg($remotePath);
        $this->runOnServer($server, ["rm -f {$escapedPath}"], throwError: false);

        foreach (str_split(base64_encode($contents), 48000) as $chunk) {
            $encodedChunk = escapeshellarg($chunk);
            $this->runRemoteProcess(
                $server,
                ["printf %s {$encodedChunk} | base64 -d >> {$escapedPath}"],
                'Impossible de transférer le dump SQL vers le serveur',
            );
        }
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
