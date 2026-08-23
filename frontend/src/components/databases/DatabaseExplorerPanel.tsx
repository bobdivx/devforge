import { Database, RefreshCw, Table2 } from 'lucide-preact';
import { useEffect, useState } from 'preact/hooks';
import { domainApi, type DatabaseExplorerOverview, type DatabaseTablePreview } from '../../lib/domain-api';
import { DataState } from '../ui/DataState';
import { Table } from '../ui/Table';

type DatabaseExplorerPanelProps = {
    databaseUuid: string;
    isRunning: boolean;
};

function formatCellValue(value: unknown): string {
    if (value === null || value === undefined) {
        return 'NULL';
    }

    if (typeof value === 'object') {
        return JSON.stringify(value);
    }

    return String(value);
}

export function DatabaseExplorerPanel({ databaseUuid, isRunning }: DatabaseExplorerPanelProps) {
    const [overview, setOverview] = useState<DatabaseExplorerOverview | null>(null);
    const [preview, setPreview] = useState<DatabaseTablePreview | null>(null);
    const [selectedTable, setSelectedTable] = useState<string | null>(null);
    const [loadingOverview, setLoadingOverview] = useState(true);
    const [loadingPreview, setLoadingPreview] = useState(false);
    const [error, setError] = useState<unknown>(null);

    const loadOverview = async () => {
        setLoadingOverview(true);
        setError(null);
        try {
            const response = await domainApi.databaseExplorer(databaseUuid);
            setOverview(response.data);
            if (response.data.tables.length === 0) {
                setPreview(null);
                setSelectedTable(null);
            }
        } catch (loadError: unknown) {
            setError(loadError);
        } finally {
            setLoadingOverview(false);
        }
    };

    const loadPreview = async (table: string) => {
        setSelectedTable(table);
        setLoadingPreview(true);
        setError(null);
        try {
            const response = await domainApi.databaseExplorerTable(databaseUuid, table);
            setPreview(response.data);
        } catch (loadError: unknown) {
            setPreview(null);
            setError(loadError);
        } finally {
            setLoadingPreview(false);
        }
    };

    useEffect(() => {
        void loadOverview();
    }, [databaseUuid]);

    return (
        <section class="rounded-xl border border-base-300/70 bg-base-200/20 p-4">
            <div class="toolbar-row mb-3">
                <div>
                    <h3 class="text-xs sm:text-sm font-semibold">Contenu de la base</h3>
                    <p class="text-xs text-base-content/55">
                        Parcourez les tables SQLite importées. L’explorateur lit le fichier <span class="font-mono">data.db</span>
                        {isRunning ? ' (base démarrée).' : ' même si la base est arrêtée.'}
                    </p>
                </div>
                <button class="btn btn-ghost btn-sm w-full sm:w-auto" type="button" onClick={() => void loadOverview()} disabled={loadingOverview}>
                    <RefreshCw class={`size-3.5 ${loadingOverview ? 'animate-spin' : ''}`} aria-hidden />
                    Actualiser
                </button>
            </div>

            <DataState loading={loadingOverview} error={error} onRetry={() => void loadOverview()}>
                {overview && !overview.available && (
                    <div class="rounded-lg border border-dashed border-base-300/80 bg-base-100/60 px-4 py-6 text-sm text-base-content/60">
                        <div class="mb-2 flex items-center gap-2 font-medium text-base-content/75">
                            <Database class="size-4" aria-hidden />
                            Base vide ou non initialisée
                        </div>
                        <p>{overview.message ?? 'Aucun fichier data.db disponible pour le moment.'}</p>
                    </div>
                )}

                {overview && overview.available && overview.tables.length === 0 && (
                    <div class="rounded-lg border border-dashed border-base-300/80 bg-base-100/60 px-4 py-6 text-sm text-base-content/60">
                        <div class="mb-2 flex items-center gap-2 font-medium text-base-content/75">
                            <Database class="size-4" aria-hidden />
                            Aucune table trouvée
                        </div>
                        <p>
                            Importez un fichier <span class="font-mono">.db</span> ou <span class="font-mono">.sql</span> ci-dessous,
                            ou démarrez la base puis réessayez si vous venez de la créer.
                        </p>
                    </div>
                )}

                {overview && overview.available && overview.tables.length > 0 && (
                    <div class="grid gap-2.5 sm:gap-3 md:gap-4 lg:grid-cols-[14rem_minmax(0,1fr)]">
                        <div class="grid gap-1">
                            <p class="text-xs font-medium uppercase tracking-wide text-base-content/45">
                                Tables ({overview.table_count})
                            </p>
                            <ul class="grid gap-1">
                                {overview.tables.map((table) => (
                                    <li key={table.name}>
                                        <button
                                            class={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition ${
                                                selectedTable === table.name
                                                    ? 'bg-primary/10 font-medium text-primary'
                                                    : 'hover:bg-base-100'
                                            }`}
                                            type="button"
                                            onClick={() => void loadPreview(table.name)}
                                        >
                                            <Table2 class="size-3.5 shrink-0" aria-hidden />
                                            <span class="truncate font-mono text-xs">{table.name}</span>
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        </div>

                        <div class="min-w-0">
                            {!selectedTable && (
                                <p class="text-sm text-base-content/55">Sélectionnez une table pour afficher son contenu.</p>
                            )}

                            {selectedTable && loadingPreview && (
                                <p class="text-sm text-base-content/55">Chargement de « {selectedTable} »…</p>
                            )}

                            {selectedTable && preview && !loadingPreview && (
                                <div class="grid gap-2">
                                    <div class="flex flex-wrap items-center gap-2 text-xs text-base-content/55">
                                        <span class="font-mono text-xs sm:text-sm font-medium text-base-content">{preview.table}</span>
                                        <span>· {preview.row_count} ligne{preview.row_count > 1 ? 's' : ''}</span>
                                        {preview.truncated && <span>· aperçu limité à {preview.rows.length}</span>}
                                    </div>

                                    {preview.columns.length === 0 ? (
                                        <p class="text-sm text-base-content/55">Table vide.</p>
                                    ) : (
                                        <div class="overflow-x-auto rounded-lg border border-base-300/70 bg-base-100">
                                            <Table headers={preview.columns} caption={`Aperçu de ${preview.table}`}>
                                                {preview.rows.map((row, index) => (
                                                    <tr key={`${preview.table}-${index}`}>
                                                        {preview.columns.map((column) => (
                                                            <td class="max-w-[16rem] truncate font-mono text-[11px]" key={`${index}-${column}`}>
                                                                {formatCellValue(row[column])}
                                                            </td>
                                                        ))}
                                                    </tr>
                                                ))}
                                            </Table>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </DataState>
        </section>
    );
}
