import { Bug, Check, Copy, RefreshCw } from 'lucide-preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { DataState } from '../ui/DataState';
import { ActionToolbar } from '../ui/ActionToolbar';
import { domainApi, type Deployment } from '../../lib/domain-api';
import { formatDeploymentLogsText } from '../../lib/deployment-log-text';
import { useDeploymentLogs } from '../../lib/use-deployment-logs';
import { useApiQuery } from '../../lib/use-api-query';

type Props = {
    deploymentUuid: string;
    deployment?: Deployment | null;
    showHeader?: boolean;
    class?: string;
};

export function DeploymentLogsPanel({
    deploymentUuid,
    deployment = null,
    showHeader = true,
    class: className = '',
}: Props) {
    const detailQuery = useApiQuery(
        deployment ? null : `deployment:${deploymentUuid}`,
        () => domainApi.deployment(deploymentUuid),
    );
    const [debugEnabled, setDebugEnabled] = useState(false);
    const [togglingDebug, setTogglingDebug] = useState(false);
    const [debugError, setDebugError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    const [copyError, setCopyError] = useState<string | null>(null);
    const logs = useDeploymentLogs(deploymentUuid, { debugKey: debugEnabled });
    const containerRef = useRef<HTMLDivElement>(null);
    const resolvedDeployment = deployment ?? detailQuery.data?.data ?? null;

    useEffect(() => {
        if (resolvedDeployment) {
            setDebugEnabled(resolvedDeployment.is_debug_enabled);
        }
    }, [resolvedDeployment?.uuid, resolvedDeployment?.is_debug_enabled]);

    useEffect(() => {
        if (!containerRef.current || logs.complete) {
            return;
        }

        containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }, [logs.lines, logs.complete]);

    const toggleDebugLogs = async () => {
        setTogglingDebug(true);
        setDebugError(null);

        try {
            const response = await domainApi.toggleDeploymentDebugLogs(deploymentUuid);
            setDebugEnabled(response.data.is_debug_enabled);
            await logs.reload();
        } catch {
            setDebugError('Impossible de modifier les logs détaillés.');
        } finally {
            setTogglingDebug(false);
        }
    };

    const copyLogs = async () => {
        if (logs.lines.length === 0) {
            return;
        }

        setCopyError(null);

        try {
            await navigator.clipboard.writeText(formatDeploymentLogsText(logs.lines));
            setCopied(true);
            window.setTimeout(() => setCopied(false), 2000);
        } catch {
            setCopyError('Impossible de copier les logs dans le presse-papiers.');
        }
    };

    return (
        <section class={`min-w-0 overflow-hidden rounded-2xl border border-base-300/70 bg-base-100 shadow-sm ${className}`}>
            {showHeader && (
                <div class="toolbar-row border-b border-base-300/70 px-3 sm:px-2.5 sm:px-3 md:px-3 sm:px-4 py-2.5 sm:py-3 sm:py-4 sm:px-5">
                    <div class="min-w-0">
                        <p class="text-xs sm:text-sm font-semibold">Logs de déploiement</p>
                        <p class="text-xs text-base-content/50">
                            {logs.complete ? 'Déploiement terminé' : 'Suivi en direct'}
                            {debugEnabled ? ' · logs détaillés activés' : ''}
                        </p>
                    </div>
                    <ActionToolbar class="w-full min-w-0 sm:w-auto">
                        <button
                            class={`btn btn-ghost btn-sm ${debugEnabled ? 'text-warning' : ''}`}
                            type="button"
                            title={debugEnabled ? 'Masquer les logs détaillés' : 'Afficher les logs détaillés'}
                            disabled={togglingDebug}
                            onClick={() => void toggleDebugLogs()}
                        >
                            <Bug class="size-3.5" aria-hidden />
                            {debugEnabled ? 'Masquer détails' : 'Logs détaillés'}
                        </button>
                        <button
                            class="btn btn-ghost btn-sm"
                            type="button"
                            title="Copier les logs"
                            disabled={logs.lines.length === 0}
                            onClick={() => void copyLogs()}
                        >
                            {copied ? <Check class="size-3.5 text-success" aria-hidden /> : <Copy class="size-3.5" aria-hidden />}
                            {copied ? 'Copié' : 'Copier'}
                        </button>
                        <button class="btn btn-ghost btn-sm" type="button" onClick={() => void logs.reload()}>
                            <RefreshCw class="size-3.5" aria-hidden />
                            Actualiser
                        </button>
                    </ActionToolbar>
                </div>
            )}

            <div class="min-w-0 overflow-hidden p-4 sm:p-5">
                {debugError && (
                    <p class="mb-3 break-words text-xs text-error">{debugError}</p>
                )}
                {copyError && (
                    <p class="mb-3 break-words text-xs text-error">{copyError}</p>
                )}

                {!deployment && (
                    <DataState loading={detailQuery.loading} error={detailQuery.error} onRetry={() => void detailQuery.reload()}>
                        {resolvedDeployment && (
                            <p class="mb-3 break-all font-mono text-[11px] text-base-content/45">{resolvedDeployment.uuid}</p>
                        )}
                    </DataState>
                )}

                <DataState loading={logs.loading} error={logs.error} onRetry={() => void logs.reload()}>
                    <div
                        ref={containerRef}
                        class="max-h-[28rem] min-w-0 overflow-x-auto overflow-y-auto rounded-xl border border-base-300 bg-black p-3 font-mono text-[11px] leading-5 break-words text-zinc-200"
                    >
                        {logs.lines.length === 0 ? (
                            <p class="text-zinc-500">
                                {logs.complete ? 'Aucune ligne de log disponible.' : 'En attente des premières lignes…'}
                            </p>
                        ) : logs.lines.map((line) => (
                            <div
                                class={[
                                    'break-words',
                                    line.stream === 'stderr' ? 'text-red-300' : '',
                                    line.hidden ? 'text-zinc-500' : '',
                                    line.command ? 'mt-2 text-sky-300' : '',
                                ].filter(Boolean).join(' ')}
                                key={line.cursor}
                            >
                                <span class="me-2 select-none text-zinc-600">{line.cursor}</span>
                                {line.hidden && <span class="me-1 text-zinc-600">[debug]</span>}
                                {line.command && <span class="me-1 text-zinc-600">[cmd]</span>}
                                {line.message}
                            </div>
                        ))}
                    </div>
                </DataState>
            </div>
        </section>
    );
}
