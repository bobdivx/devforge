import { Eye, RefreshCw } from 'lucide-preact';
import { Card } from '../ui/Card';
import { DataState } from '../ui/DataState';
import { StatusBadge } from '../ui/StatusBadge';
import { domainApi } from '../../lib/domain-api';
import { useApiQuery } from '../../lib/use-api-query';
import { navigateTo } from '../../lib/use-navigate';

type ServerDestinationsPanelProps = {
    serverUuid: string;
};

export function ServerDestinationsPanel({ serverUuid }: ServerDestinationsPanelProps) {
    const destinations = useApiQuery('destinations', () => domainApi.destinations());
    const filtered = (destinations.data?.data ?? []).filter((item) => item.server.uuid === serverUuid);

    return (
        <Card title="Destinations Docker">
            <div class="card-toolbar mb-3">
                <button class="btn btn-ghost btn-sm" type="button" onClick={() => void destinations.reload()}>
                    <RefreshCw class="size-3.5" aria-hidden />
                    Actualiser
                </button>
            </div>
            <DataState
                loading={destinations.loading}
                error={destinations.error}
                empty={filtered.length === 0}
                emptyMessage="Aucune destination sur ce serveur."
                onRetry={() => void destinations.reload()}
            >
                <div class="grid gap-2 md:grid-cols-2">
                    {filtered.map((destination) => (
                        <button
                            class="rounded-2xl border border-base-300/70 p-4 text-left shadow-sm transition hover:border-primary/30 hover:shadow-md"
                            type="button"
                            key={destination.uuid}
                            onClick={() => navigateTo(`/destination/${destination.uuid}`)}
                        >
                            <div class="mb-2 flex items-start justify-between gap-2">
                                <div class="min-w-0">
                                    <p class="truncate text-xs sm:text-sm font-semibold">{destination.name}</p>
                                    <p class="font-mono text-[11px] text-base-content/45">{destination.network}</p>
                                </div>
                                <StatusBadge label={destination.type === 'swarm' ? 'Swarm' : 'Standalone'} />
                            </div>
                            <span class="inline-flex items-center gap-1 text-xs text-primary">
                                <Eye class="size-3.5" aria-hidden />
                                Voir
                            </span>
                        </button>
                    ))}
                </div>
            </DataState>
        </Card>
    );
}
