import { RefreshCw } from 'lucide-preact';
import { useEffect, useState } from 'preact/hooks';
import { ActionToolbar } from '../ui/ActionToolbar';
import { DataState } from '../ui/DataState';
import { domainApi } from '../../lib/domain-api';
import { useApiQuery } from '../../lib/use-api-query';

type Props = {
    applicationUuid: string;
    autoRefresh?: boolean;
};

const lineOptions = [100, 200, 500];

export function ApplicationLogsPanel({ applicationUuid, autoRefresh = true }: Props) {
    const [lines, setLines] = useState(200);
    const query = useApiQuery(
        `application-logs:${applicationUuid}:${lines}`,
        () => domainApi.applicationLogs(applicationUuid, lines),
    );
    const logs = query.data?.data;

    useEffect(() => {
        if (!autoRefresh) {
            return;
        }

        const interval = window.setInterval(() => {
            void query.reload({ silent: true });
        }, 2000);

        return () => window.clearInterval(interval);
    }, [autoRefresh, applicationUuid, lines]);

    return (
        <section class="rounded-2xl border border-base-300/70 bg-base-100 shadow-sm">
            <div class="toolbar-row border-b border-base-300/70 px-3 sm:px-4 md:px-5 py-3 sm:py-4">
                <div>
                    <p class="text-xs sm:text-sm font-semibold">Logs du conteneur</p>
                    <p class="text-xs text-base-content/50">Sortie stdout/stderr en temps réel</p>
                </div>
                <div class="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
                    <label class="flex items-center gap-2 text-xs">
                        <span class="text-base-content/45">Lignes</span>
                        <select
                            class="select select-bordered select-sm w-full sm:w-auto"
                            value={lines}
                            onChange={(event) => setLines(Number((event.target as HTMLSelectElement).value))}
                        >
                            {lineOptions.map((option) => (
                                <option key={option} value={option}>{option}</option>
                            ))}
                        </select>
                    </label>
                    <ActionToolbar>
                        <button class="btn btn-ghost btn-sm" type="button" onClick={() => void query.reload()}>
                            <RefreshCw class="size-3.5" aria-hidden />
                            Actualiser
                        </button>
                    </ActionToolbar>
                </div>
            </div>

            <div class="p-5">
                {logs?.container && (
                    <p class="mb-3 font-mono text-[11px] text-base-content/45">
                        {logs.container}
                        {logs.container_status ? ` · ${logs.container_status}` : ''}
                    </p>
                )}

                <DataState loading={query.loading} error={query.error} onRetry={() => void query.reload()}>
                    {logs && (
                        <>
                            {!logs.available && (
                                <p class="mb-3 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                                    {logs.message ?? 'Logs indisponibles.'}
                                </p>
                            )}
                            <div class="max-h-[28rem] overflow-auto rounded-xl border border-base-300 bg-black p-3 font-mono text-[11px] leading-5 text-zinc-200">
                                {logs.items.length === 0 ? (
                                    <p class="text-zinc-500">Aucune ligne de log disponible.</p>
                                ) : logs.items.map((line) => (
                                    <div key={line.cursor}>
                                        <span class="me-2 select-none text-zinc-600">{line.cursor}</span>
                                        {line.message}
                                    </div>
                                ))}
                            </div>
                        </>
                    )}
                </DataState>
            </div>
        </section>
    );
}
