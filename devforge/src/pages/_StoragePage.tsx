import { useCallback, useState } from 'preact/hooks';
import { PageHeader } from '../components/PageHeader';
import { ServerStorageCard } from '../components/storage/ServerStorageCard';
import { DataState } from '../components/ui/DataState';
import { StatusBadge } from '../components/ui/StatusBadge';
import type { BootstrapPermissions } from '../lib/bootstrap';
import { domainApi, type ServerStorageSummary } from '../lib/domain-api';
import { routeHref } from '../lib/routes';
import { useApiQuery } from '../lib/use-api-query';

type Props = {
    permissions: BootstrapPermissions;
};

async function refreshDisksInBackground(
    servers: ServerStorageSummary[],
    onServerUpdated: (server: ServerStorageSummary) => void,
): Promise<void> {
    await Promise.allSettled(
        servers
            .filter((server) => server.status.functional)
            .map(async (server) => {
                try {
                    const response = await domainApi.refreshServerDiskUsage(server.uuid);
                    onServerUpdated({
                        ...server,
                        disk_usage_percent: response.data.disk_usage_percent,
                        disk_partitions: response.data.disk_partitions ?? null,
                    });
                } catch {
                    // Conserver la valeur en cache ou null si la mesure SSH échoue.
                }
            }),
    );
}

export function StoragePage({ permissions }: Props) {
    const [servers, setServers] = useState<ServerStorageSummary[]>([]);
    const [measuringDisks, setMeasuringDisks] = useState(false);

    const handleServerUpdated = useCallback((updated: ServerStorageSummary) => {
        setServers((current) => current.map((server) => (
            server.uuid === updated.uuid ? updated : server
        )));
    }, []);

    const query = useApiQuery('server-storage', async () => {
        const response = await domainApi.serverStorageOverview(false);
        setServers(response.data);
        setMeasuringDisks(true);
        void refreshDisksInBackground(response.data, handleServerUpdated).finally(() => {
            setMeasuringDisks(false);
        });

        return response;
    });

    const schedulerHealthy = query.data?.meta?.scheduler_healthy ?? true;

    return (
        <div class="grid gap-5">
            <PageHeader
                title="Stockage serveurs"
                description="Surveillez l’espace disque, configurez le nettoyage Docker automatique et lancez un nettoyage manuel."
                actions={(
                    <a class="btn btn-ghost btn-sm" href={routeHref('/storages')}>
                        Stockage S3
                    </a>
                )}
            />

            {!schedulerHealthy && (
                <div class="rounded-2xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
                    Le planificateur de tâches semble inactif — les nettoyages automatiques peuvent être retardés.
                </div>
            )}

            <DataState
                loading={query.loading}
                error={query.error}
                empty={servers.length === 0}
                emptyMessage="Aucun serveur dans l’équipe active."
                onRetry={() => void query.reload()}
            >
                <div class="mb-3 flex flex-wrap items-center gap-2 text-xs text-base-content/55">
                    <StatusBadge label="Automatique" tone="success" />
                    <span>Nettoyage Docker selon le seuil configuré · Surveillance disque via cron</span>
                    {measuringDisks && (
                        <StatusBadge label="Mesure disque…" tone="warning" />
                    )}
                </div>

                <div class="grid gap-4">
                    {servers.map((server) => (
                        <ServerStorageCard
                            key={server.uuid}
                            server={server}
                            canManage={permissions.create_resources}
                            onUpdated={handleServerUpdated}
                        />
                    ))}
                </div>
            </DataState>
        </div>
    );
}
