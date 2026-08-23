import { RefreshCw } from 'lucide-preact';
import { ServerStorageCard } from '../storage/ServerStorageCard';
import { DataState } from '../ui/DataState';
import { domainApi } from '../../lib/domain-api';
import { useApiQuery } from '../../lib/use-api-query';

type ServerCleanupPanelProps = {
    serverUuid: string;
    canManage: boolean;
};

export function ServerCleanupPanel({ serverUuid, canManage }: ServerCleanupPanelProps) {
    const storage = useApiQuery(
        `server-storage:${serverUuid}`,
        () => domainApi.serverStorage(serverUuid),
    );

    return (
        <div class="grid gap-2.5 sm:gap-3 md:gap-4">
            <div class="flex justify-end">
                <button class="btn btn-ghost btn-sm" type="button" onClick={() => void storage.reload()}>
                    <RefreshCw class="size-3.5" aria-hidden />
                    Actualiser
                </button>
            </div>
            <DataState loading={storage.loading} error={storage.error} onRetry={() => void storage.reload()}>
                {storage.data?.data && (
                    <ServerStorageCard
                        server={storage.data.data}
                        canManage={canManage}
                        onUpdated={() => {
                            void storage.reload();
                        }}
                    />
                )}
            </DataState>
        </div>
    );
}
