<?php

namespace App\Services\DevForge\Database;

use App\Actions\Database\StartDatabase;
use App\Actions\Database\StopDatabase;
use App\Models\StandaloneLibsql;
use Symfony\Component\HttpKernel\Exception\HttpException;

class LibsqlDatabaseTransferService
{
    private const SQLITE_RUNNER_IMAGE = 'alpine:3.20';

    private const DB_RELATIVE_PATH = '/var/lib/sqld/data.db';

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

        $output = trim((string) instant_remote_process([$command], $server));

        if ($output === '') {
            throw new HttpException(422, 'L’export SQL est vide. Vérifiez que la base contient un fichier data.db.');
        }

        return $output."\n";
    }

    /**
     * @return array{restarted: bool, message: string}
     */
    public function import(StandaloneLibsql $database, string $sql): array
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
                ." sh -c 'apk add --no-cache sqlite >/dev/null 2>&1 && rm -f /var/lib/sqld/data.db /var/lib/sqld/data.db-wal /var/lib/sqld/data.db-shm && sqlite3 /var/lib/sqld/data.db < /import.sql'";

            instant_remote_process([$importCommand], $server);
        } finally {
            instant_remote_process(['rm -f '.escapeshellarg($remoteSqlPath)], $server, throwError: false);
        }

        StartDatabase::dispatch($database);

        return [
            'restarted' => true,
            'message' => 'Import terminé. La base redémarre.',
        ];
    }

    private function assertDatabaseFileExists(StandaloneLibsql $database): void
    {
        $volume = escapeshellarg($this->volumeName($database));
        $checkCommand = "docker run --rm -v {$volume}:/var/lib/sqld:ro "
            .escapeshellarg(self::SQLITE_RUNNER_IMAGE)
            ." sh -c 'test -f /var/lib/sqld/data.db'";

        $server = $database->destination->server;
        try {
            instant_remote_process([$checkCommand], $server);
        } catch (\Throwable) {
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
            ." sh -c 'apk add --no-cache sqlite >/dev/null 2>&1 && sqlite3 {$dbPath} {$sqliteArgs}'";
    }

    private function volumeName(StandaloneLibsql $database): string
    {
        return 'libsql-data-'.$database->uuid;
    }

    private function writeRemoteFile($server, string $remotePath, string $contents): void
    {
        $escapedPath = escapeshellarg($remotePath);
        instant_remote_process(["rm -f {$escapedPath}"], $server, throwError: false);

        foreach (str_split(base64_encode($contents), 48000) as $chunk) {
            $encodedChunk = escapeshellarg($chunk);
            instant_remote_process(["printf %s {$encodedChunk} | base64 -d >> {$escapedPath}"], $server);
        }
    }
}
