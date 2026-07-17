<?php

namespace App\Services\DevForge\Database;

use App\Models\StandaloneLibsql;
use Symfony\Component\HttpKernel\Exception\HttpException;

class LibsqlDatabaseExplorerService
{
    public function __construct(
        private readonly LibsqlDatabaseTransferService $libsqlDatabaseTransferService,
    ) {}

    /**
     * @return array{
     *     available: bool,
     *     table_count: int,
     *     tables: array<int, array{name: string, row_count: int|null}>,
     *     message?: string
     * }
     */
    public function overview(StandaloneLibsql $database): array
    {
        if (! $this->libsqlDatabaseTransferService->databaseFileExists($database)) {
            return [
                'available' => false,
                'table_count' => 0,
                'tables' => [],
                'message' => 'Aucun fichier data.db trouvé. Importez un fichier .db ou démarrez la base une première fois.',
            ];
        }

        try {
            $tables = $this->listTables($database);
        } catch (HttpException $exception) {
            return [
                'available' => false,
                'table_count' => 0,
                'tables' => [],
                'message' => $exception->getMessage(),
            ];
        }

        return [
            'available' => true,
            'table_count' => count($tables),
            'tables' => $tables,
        ];
    }

    /**
     * @return array{
     *     table: string,
     *     columns: array<int, string>,
     *     rows: array<int, array<string, mixed>>,
     *     row_count: int,
     *     truncated: bool
     * }
     */
    public function previewTable(StandaloneLibsql $database, string $table, int $limit = 50): array
    {
        $this->assertValidTableName($table);
        $limit = max(1, min($limit, 200));

        $quotedTable = '"'.str_replace('"', '""', $table).'"';
        $rows = $this->libsqlDatabaseTransferService->queryJson(
            $database,
            "SELECT * FROM {$quotedTable} LIMIT {$limit}",
        );

        $countRows = $this->libsqlDatabaseTransferService->queryJson(
            $database,
            "SELECT COUNT(*) AS total FROM {$quotedTable}",
        );
        $total = (int) ($countRows[0]['total'] ?? count($rows));

        $columns = $rows !== [] ? array_keys($rows[0]) : $this->tableColumns($database, $table);

        return [
            'table' => $table,
            'columns' => $columns,
            'rows' => $rows,
            'row_count' => $total,
            'truncated' => $total > count($rows),
        ];
    }

    /**
     * @return array<int, array{name: string, row_count: int|null}>
     */
    private function listTables(StandaloneLibsql $database): array
    {
        $rows = $this->libsqlDatabaseTransferService->queryJson(
            $database,
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        );

        return array_map(function (array $row): array {
            $name = (string) ($row['name'] ?? '');

            return [
                'name' => $name,
                'row_count' => null,
            ];
        }, $rows);
    }

    /**
     * @return array<int, string>
     */
    private function tableColumns(StandaloneLibsql $database, string $table): array
    {
        $quotedTable = '"'.str_replace('"', '""', $table).'"';
        $rows = $this->libsqlDatabaseTransferService->queryJson(
            $database,
            "PRAGMA table_info({$quotedTable})",
        );

        return array_values(array_filter(array_map(
            fn (array $row): string => (string) ($row['name'] ?? ''),
            $rows,
        )));
    }

    private function assertValidTableName(string $table): void
    {
        if (! preg_match('/^[A-Za-z0-9_]+$/', $table)) {
            throw new HttpException(422, 'Nom de table invalide.');
        }
    }
}
