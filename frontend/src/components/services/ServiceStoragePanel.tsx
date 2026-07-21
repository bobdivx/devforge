import { HardDrive, RefreshCw } from 'lucide-preact';
import { ActionToolbar } from '../ui/ActionToolbar';
import { DataState } from '../ui/DataState';
import { StatusBadge } from '../ui/StatusBadge';
import { Table } from '../ui/Table';
import { domainApi, type ServiceStorage, type ServiceStorageGroup } from '../../lib/domain-api';
import { useApiQuery } from '../../lib/use-api-query';

type Props = {
    serviceUuid: string;
};

function typeLabel(storage: ServiceStorage): string {
    if (storage.type === 'persistent') {
        return 'Volume';
    }

    return storage.is_directory ? 'Répertoire' : 'Fichier';
}

function childTypeLabel(type: ServiceStorageGroup['child_type']): string {
    return type === 'application' ? 'Application' : 'Base';
}

export function ServiceStoragePanel({ serviceUuid }: Props) {
    const query = useApiQuery(
        `service-storages:${serviceUuid}`,
        () => domainApi.serviceStorages(serviceUuid),
    );
    const payload = query.data?.data;
    const groups = payload?.groups ?? [];

    return (
        <section class="rounded-2xl border border-base-300/70 bg-base-100 shadow-sm">
            <div class="toolbar-row border-b border-base-300/70 px-5 py-4">
                <div>
                    <div class="flex items-center gap-2">
                        <HardDrive class="size-4 text-base-content/45" aria-hidden />
                        <p class="text-sm font-semibold">Storages</p>
                    </div>
                    <p class="text-xs text-base-content/50">
                        Volumes gérés par le compose — lecture seule
                    </p>
                </div>
                <ActionToolbar>
                    <button class="btn btn-ghost btn-sm" type="button" onClick={() => void query.reload()}>
                        <RefreshCw class="size-3.5" aria-hidden />
                        Actualiser
                    </button>
                </ActionToolbar>
            </div>

            <div class="grid gap-4 p-5">
                <DataState loading={query.loading} error={query.error} onRetry={() => void query.reload()}>
                    {groups.length === 0 ? (
                        <p class="text-sm text-base-content/55">Aucun storage détecté sur ce service.</p>
                    ) : (
                        groups.map((group) => (
                            <div key={group.child_uuid} class="grid gap-2">
                                <div class="flex flex-wrap items-center gap-2">
                                    <p class="text-sm font-semibold">{group.child_name}</p>
                                    <StatusBadge tone="neutral" label={childTypeLabel(group.child_type)} />
                                </div>
                                <Table headers={['Type', 'Nom / chemin', 'Mount']} embedded>
                                    {group.storages.map((storage) => (
                                        <tr key={storage.uuid}>
                                            <td>{typeLabel(storage)}</td>
                                            <td class="font-mono text-xs">{storage.name || storage.fs_path || '—'}</td>
                                            <td class="font-mono text-xs">{storage.mount_path}</td>
                                        </tr>
                                    ))}
                                </Table>
                            </div>
                        ))
                    )}
                </DataState>
            </div>
        </section>
    );
}
