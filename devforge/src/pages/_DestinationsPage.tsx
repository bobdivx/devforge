import { ExternalLink, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-preact';
import { useState } from 'preact/hooks';
import { ActionToolbar } from '../components/ui/ActionToolbar';
import { DestinationFormModal } from '../components/destinations/DestinationFormModal';
import { PageHeader } from '../components/PageHeader';
import { Card } from '../components/ui/Card';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { DataState } from '../components/ui/DataState';
import { StatusBadge } from '../components/ui/StatusBadge';
import { Table } from '../components/ui/Table';
import { SettingsDetailList } from '../components/settings/SettingsPanels';
import type { BootstrapPermissions } from '../lib/bootstrap';
import {
    domainApi,
    type DestinationInput,
    type DestinationSummary,
    type DestinationUpdateInput,
} from '../lib/domain-api';
import { legacyCoolifyUrl } from '../lib/migration';
import { destinationShowsResources, extractDestinationUuid } from '../lib/server-sections';
import { useApiQuery } from '../lib/use-api-query';
import { navigateTo } from '../lib/use-navigate';

type DestinationsPageProps = {
    path: string;
    permissions: BootstrapPermissions;
    legacyBaseUrl?: string;
};

export function DestinationsPage({ path, permissions, legacyBaseUrl = '' }: DestinationsPageProps) {
    const destinationUuid = extractDestinationUuid(path);
    const showResources = destinationShowsResources(path);
    const canManage = permissions.create_resources;

    if (destinationUuid) {
        return (
            <DestinationDetailPage
                destinationUuid={destinationUuid}
                legacyBaseUrl={legacyBaseUrl}
                showResources={showResources}
                canManage={canManage}
            />
        );
    }

    const destinations = useApiQuery('destinations', () => domainApi.destinations());
    const [createOpen, setCreateOpen] = useState(false);
    const [mutationError, setMutationError] = useState<string | null>(null);

    const reload = async () => {
        setMutationError(null);
        await destinations.reload();
    };

    return (
        <div class="grid gap-5">
            <PageHeader
                title="Destinations"
                description="Réseaux Docker et cibles de déploiement de l’équipe active."
                actions={canManage ? (
                    <button class="btn btn-primary btn-sm" type="button" onClick={() => setCreateOpen(true)}>
                        <Plus class="size-3.5" aria-hidden />
                        Nouvelle destination
                    </button>
                ) : undefined}
            />
            <Card title="Destinations">
                <div class="card-toolbar mb-3">
                    <button class="btn btn-ghost btn-sm" type="button" onClick={() => void reload()}>
                        <RefreshCw class="size-3.5" aria-hidden />
                        Actualiser
                    </button>
                </div>
                {mutationError && <div class="alert alert-error mb-3 min-h-8 py-1 text-xs" role="alert">{mutationError}</div>}
                <DataState
                    loading={destinations.loading}
                    error={destinations.error}
                    empty={(destinations.data?.data.length ?? 0) === 0}
                    emptyMessage="Aucune destination configurée."
                    onRetry={() => void reload()}
                >
                    <div class="grid gap-2 md:grid-cols-2">
                        {(destinations.data?.data ?? []).map((destination) => (
                            <DestinationCard key={destination.uuid} destination={destination} />
                        ))}
                    </div>
                </DataState>
            </Card>
            {canManage && (
                <DestinationFormModal
                    open={createOpen}
                    mode="create"
                    onClose={() => setCreateOpen(false)}
                    onSubmit={async (input) => {
                        try {
                            const response = await domainApi.createDestination(input as DestinationInput);
                            await reload();
                            navigateTo(`/destination/${response.data.uuid}`);
                        } catch {
                            setMutationError('La création a échoué. Vérifiez le réseau et le serveur sélectionné.');
                            throw new Error('create failed');
                        }
                    }}
                />
            )}
        </div>
    );
}

function DestinationCard({ destination }: { destination: DestinationSummary }) {
    return (
        <button
            class="rounded-2xl border border-base-300/70 p-4 text-left shadow-sm transition hover:border-primary/30 hover:shadow-md"
            type="button"
            onClick={() => navigateTo(`/destination/${destination.uuid}`)}
        >
            <div class="mb-2 flex items-start justify-between gap-2">
                <div class="min-w-0">
                    <p class="truncate text-sm font-semibold">{destination.name}</p>
                    <p class="truncate text-xs text-base-content/55">{destination.server.name}</p>
                </div>
                <StatusBadge label={destination.type === 'swarm' ? 'Swarm' : 'Standalone'} />
            </div>
            <p class="font-mono text-[11px] text-base-content/45">{destination.network}</p>
            <p class="mt-2 text-xs text-base-content/55">{destination.resource_count} ressource(s)</p>
        </button>
    );
}

function DestinationDetailPage({
    destinationUuid,
    legacyBaseUrl,
    showResources,
    canManage,
}: {
    destinationUuid: string;
    legacyBaseUrl: string;
    showResources: boolean;
    canManage: boolean;
}) {
    const destination = useApiQuery(`destination:${destinationUuid}`, () => domainApi.destination(destinationUuid));
    const resources = useApiQuery(
        showResources ? `destination-resources:${destinationUuid}` : null,
        () => domainApi.destinationResources(destinationUuid),
    );
    const data = destination.data?.data;
    const [editOpen, setEditOpen] = useState(false);
    const [deleteOpen, setDeleteOpen] = useState(false);
    const [mutationError, setMutationError] = useState<string | null>(null);

    const reload = async () => {
        setMutationError(null);
        await destination.reload();
    };

    return (
        <div class="grid gap-5">
            <PageHeader
                title={data?.name ?? 'Destination'}
                description={showResources ? 'Ressources déployées sur cette destination.' : 'Détail de la destination Docker.'}
                actions={canManage && data && !showResources ? (
                    <ActionToolbar>
                        <button class="btn btn-ghost btn-sm" type="button" onClick={() => setEditOpen(true)}>
                            <Pencil class="size-3.5" aria-hidden />
                            Modifier
                        </button>
                        <button class="btn btn-ghost btn-sm text-error" type="button" onClick={() => setDeleteOpen(true)}>
                            <Trash2 class="size-3.5" aria-hidden />
                            Supprimer
                        </button>
                    </ActionToolbar>
                ) : undefined}
            />
            {mutationError && <div class="alert alert-error min-h-8 py-1 text-xs" role="alert">{mutationError}</div>}
            <DataState loading={destination.loading} error={destination.error} onRetry={() => void reload()}>
                {data && !showResources && (
                    <Card title={data.name}>
                        <SettingsDetailList items={[
                            { label: 'Type', value: data.type === 'swarm' ? 'Swarm' : 'Standalone' },
                            { label: 'Réseau', value: data.network },
                            { label: 'Serveur', value: data.server.name },
                            { label: 'IP', value: data.server.ip ?? '—' },
                            { label: 'Ressources', value: String(data.resource_count) },
                        ]}
                        />
                        {data.supports_resources_page && (
                            <button
                                class="btn btn-ghost btn-sm mt-4"
                                type="button"
                                onClick={() => navigateTo(`/destination/${destinationUuid}/resources`)}
                            >
                                Voir les ressources
                            </button>
                        )}
                    </Card>
                )}
            </DataState>
            {showResources && (
                <Card title="Ressources attachées">
                    <DataState
                        loading={resources.loading}
                        error={resources.error}
                        empty={(resources.data?.data.length ?? 0) === 0}
                        emptyMessage="Aucune ressource sur cette destination."
                        onRetry={() => void resources.reload()}
                    >
                        <Table headers={['Nom', 'Type', 'Projet', 'Environnement']} caption="Ressources de la destination">
                            {(resources.data?.data ?? []).map((resource) => (
                                <tr key={`${resource.type}:${resource.uuid}`}>
                                    <td>{resource.name}</td>
                                    <td class="capitalize">{resource.type}</td>
                                    <td>{resource.project ?? '—'}</td>
                                    <td>{resource.environment ?? '—'}</td>
                                </tr>
                            ))}
                        </Table>
                    </DataState>
                    <a
                        class="btn btn-ghost btn-sm mt-3 w-fit"
                        href={legacyCoolifyUrl(legacyBaseUrl, `/destination/${destinationUuid}/resources`)}
                        rel="noreferrer"
                        target="_blank"
                    >
                        <ExternalLink class="size-3.5" aria-hidden />
                        Ouvrir dans Coolify
                    </a>
                </Card>
            )}
            {canManage && data && (
                <>
                    <DestinationFormModal
                        open={editOpen}
                        mode="edit"
                        destination={data}
                        onClose={() => setEditOpen(false)}
                        onSubmit={async (input) => {
                            try {
                                await domainApi.updateDestination(destinationUuid, input as DestinationUpdateInput);
                                await reload();
                            } catch {
                                setMutationError('La mise à jour a échoué.');
                                throw new Error('update failed');
                            }
                        }}
                    />
                    <ConfirmDialog
                        open={deleteOpen}
                        title="Supprimer la destination"
                        message={data.has_attached_resources
                            ? 'Cette destination a encore des ressources attachées. Supprimez-les avant de continuer.'
                            : `Supprimer définitivement « ${data.name} » ?`}
                        confirmLabel="Supprimer"
                        tone="danger"
                        onCancel={() => setDeleteOpen(false)}
                        onConfirm={() => {
                            if (data.has_attached_resources) {
                                setDeleteOpen(false);
                                return;
                            }

                            void domainApi.deleteDestination(destinationUuid)
                                .then(() => navigateTo('/destinations'))
                                .catch(() => setMutationError('La suppression a échoué.'))
                                .finally(() => setDeleteOpen(false));
                        }}
                    />
                </>
            )}
        </div>
    );
}
