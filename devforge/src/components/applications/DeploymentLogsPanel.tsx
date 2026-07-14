import { RefreshCw } from 'lucide-preact';
import { useEffect, useRef } from 'preact/hooks';
import { DataState } from '../ui/DataState';
import { ActionToolbar } from '../ui/ActionToolbar';
import { DeploymentStatusIcon } from '../ui/DeploymentStatusIcon';
import { domainApi, type Deployment } from '../../lib/domain-api';
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
    const logs = useDeploymentLogs(deploymentUuid);
    const containerRef = useRef<HTMLDivElement>(null);
    const resolvedDeployment = deployment ?? detailQuery.data?.data ?? null;

    useEffect(() => {
        if (!containerRef.current || logs.complete) {
            return;
        }

        containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }, [logs.lines, logs.complete]);

    return (
        <section class={`rounded-2xl border border-base-300/70 bg-base-100 shadow-sm ${className}`}>
            {showHeader && (
                <div class="flex flex-wrap items-center justify-between gap-3 border-b border-base-300/70 px-5 py-4">
                    <div>
                        <p class="text-sm font-semibold">Logs de déploiement</p>
                        <p class="text-xs text-base-content/50">
                            {logs.complete ? 'Déploiement terminé' : 'Suivi en direct'}
                        </p>
                    </div>
                    <ActionToolbar>
                        {resolvedDeployment && (
                            <DeploymentStatusIcon status={resolvedDeployment.status} showLabel />
                        )}
                        <button class="btn btn-ghost btn-sm" type="button" onClick={() => void logs.reload()}>
                            <RefreshCw class="size-3.5" aria-hidden />
                            Actualiser
                        </button>
                    </ActionToolbar>
                </div>
            )}

            <div class="p-5">
                {!deployment && (
                    <DataState loading={detailQuery.loading} error={detailQuery.error} onRetry={() => void detailQuery.reload()}>
                        {resolvedDeployment && (
                            <p class="mb-3 font-mono text-[11px] text-base-content/45">{resolvedDeployment.uuid}</p>
                        )}
                    </DataState>
                )}

                <DataState loading={logs.loading} error={logs.error} onRetry={() => void logs.reload()}>
                    <div
                        ref={containerRef}
                        class="max-h-[28rem] overflow-auto rounded-xl border border-base-300 bg-black p-3 font-mono text-[11px] leading-5 text-zinc-200"
                    >
                        {logs.lines.length === 0 ? (
                            <p class="text-zinc-500">
                                {logs.complete ? 'Aucune ligne de log disponible.' : 'En attente des premières lignes…'}
                            </p>
                        ) : logs.lines.map((line) => (
                            <div class={line.stream === 'stderr' ? 'text-red-300' : ''} key={line.cursor}>
                                <span class="me-2 select-none text-zinc-600">{line.cursor}</span>
                                {line.message}
                            </div>
                        ))}
                    </div>
                </DataState>
            </div>
        </section>
    );
}
