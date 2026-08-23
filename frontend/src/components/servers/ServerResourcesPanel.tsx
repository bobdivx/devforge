import { Eye, RefreshCw } from 'lucide-preact';
import { Card } from '../ui/Card';
import { DataState } from '../ui/DataState';
import { ResourceStatusIcon } from '../ui/ResourceStatusIcon';
import { domainApi, type CoreResource } from '../../lib/domain-api';
import { resourceStatusInput } from '../../lib/resource-status';
import { useApiQuery } from '../../lib/use-api-query';
import { navigateTo } from '../../lib/use-navigate';

type ServerResourcesPanelProps = {
    serverUuid: string;
};

function serverUuidOf(resource: CoreResource): string | null {
    const server = resource.configuration?.server;
    if (server && typeof server === 'object' && 'uuid' in server) {
        return String((server as { uuid?: string }).uuid ?? '') || null;
    }

    return null;
}

function hrefFor(resource: CoreResource): string {
    if (resource.type === 'application') {
        return `/applications/${resource.uuid}`;
    }
    if (resource.type === 'database') {
        return `/databases?uuid=${encodeURIComponent(resource.uuid)}`;
    }

    return `/services?uuid=${encodeURIComponent(resource.uuid)}`;
}

export function ServerResourcesPanel({ serverUuid }: ServerResourcesPanelProps) {
    const apps = useApiQuery('core:applications', () => domainApi.coreResources('applications'));
    const databases = useApiQuery('core:databases', () => domainApi.coreResources('databases'));
    const services = useApiQuery('core:services', () => domainApi.coreResources('services'));

    const loading = apps.loading || databases.loading || services.loading;
    const error = apps.error ?? databases.error ?? services.error;
    const resources = [
        ...(apps.data?.data ?? []),
        ...(databases.data?.data ?? []),
        ...(services.data?.data ?? []),
    ].filter((resource) => serverUuidOf(resource) === serverUuid);

    const reload = async () => {
        await Promise.all([apps.reload(), databases.reload(), services.reload()]);
    };

    return (
        <Card title="Ressources sur ce serveur">
            <div class="card-toolbar mb-3">
                <button class="btn btn-ghost btn-sm" type="button" onClick={() => void reload()}>
                    <RefreshCw class="size-3.5" aria-hidden />
                    Actualiser
                </button>
            </div>
            <DataState
                loading={loading}
                error={error}
                empty={resources.length === 0}
                emptyMessage="Aucune application, base ou service sur ce serveur."
                onRetry={() => void reload()}
            >
                <div class="grid gap-2 md:grid-cols-2">
                    {resources.map((resource) => (
                        <button
                            class="rounded-2xl border border-base-300/70 p-4 text-left shadow-sm transition hover:border-primary/30 hover:shadow-md"
                            type="button"
                            key={`${resource.type}:${resource.uuid}`}
                            onClick={() => navigateTo(hrefFor(resource))}
                        >
                            <div class="mb-2 flex items-start justify-between gap-2">
                                <div class="min-w-0">
                                    <p class="truncate text-xs sm:text-sm font-semibold">{resource.name}</p>
                                    <p class="text-[11px] uppercase tracking-wide text-base-content/45">{resource.type}</p>
                                </div>
                                <ResourceStatusIcon status={resourceStatusInput(resource)} />
                            </div>
                            <span class="inline-flex items-center gap-1 text-xs text-primary">
                                <Eye class="size-3.5" aria-hidden />
                                Ouvrir
                            </span>
                        </button>
                    ))}
                </div>
            </DataState>
        </Card>
    );
}
