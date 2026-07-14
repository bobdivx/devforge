import { RefreshCw } from 'lucide-preact';
import { PageHeader } from '../components/PageHeader';
import { Card } from '../components/ui/Card';
import { DataState } from '../components/ui/DataState';
import { StatusBadge } from '../components/ui/StatusBadge';
import { ResourceStatusIcon } from '../components/ui/ResourceStatusIcon';
import { domainApi } from '../lib/domain-api';
import { useApiQuery } from '../lib/use-api-query';

export function MonitoringPage() {
    const statuses = useApiQuery('resource-statuses', () => domainApi.statuses());
    const realtime = useApiQuery('realtime', () => domainApi.realtime());

    const reload = async () => {
        await Promise.all([statuses.reload(), realtime.reload()]);
    };

    return (
        <>
            <PageHeader
                title="Supervision"
                description="Statuts des ressources et configuration temps réel."
                actions={(
                    <button class="btn btn-ghost btn-sm" type="button" onClick={() => void reload()}>
                        <RefreshCw class="size-3.5" aria-hidden />
                        Actualiser
                    </button>
                )}
            />
            <Card title="Transport temps réel">
                <DataState loading={realtime.loading} error={realtime.error} onRetry={() => void realtime.reload()}>
                    {realtime.data && (
                        <div class="toolbar-row text-xs">
                            <span>{realtime.data.data.transport.driver} · {realtime.data.data.transport.host}:{realtime.data.data.transport.port}</span>
                            <StatusBadge label={`${realtime.data.data.polling.recommended_interval_ms} ms`} tone="success" />
                        </div>
                    )}
                </DataState>
            </Card>
            <DataState loading={statuses.loading} error={statuses.error} onRetry={() => void statuses.reload()}>
                {statuses.data && (
                    <div class="grid gap-3 md:grid-cols-2">
                        {Object.entries(statuses.data.data).map(([type, resources]) => (
                            <Card title={type} eyebrow={`${resources.length} ressource(s)`} key={type}>
                                {resources.length === 0 ? (
                                    <p class="text-xs text-base-content/45">Aucune ressource.</p>
                                ) : (
                                    <ul class="divide-y divide-base-300">
                                        {resources.map((resource) => (
                                            <li class="flex items-center justify-between gap-2 py-2" key={resource.uuid}>
                                                <span class="truncate text-xs">{resource.name}</span>
                                                <ResourceStatusIcon status={resource.status} showLabel />
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </Card>
                        ))}
                    </div>
                )}
            </DataState>
        </>
    );
}
