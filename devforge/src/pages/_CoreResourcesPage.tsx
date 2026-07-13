import { Eye, Play, Plus, RefreshCw, RotateCw, Rocket, Square } from 'lucide-preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { ApplicationDetailPanel } from '../components/applications/ApplicationDetailPanel';
import { CreateApplicationModal } from '../components/applications/CreateApplicationModal';
import { CreateDatabaseModal } from '../components/databases/CreateDatabaseModal';
import { DatabaseDetailPanel } from '../components/databases/DatabaseDetailPanel';
import { PageHeader } from '../components/PageHeader';
import { Breadcrumbs } from '../components/ui/Breadcrumbs';
import { Card } from '../components/ui/Card';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { DataState } from '../components/ui/DataState';
import { FilterBar } from '../components/ui/FilterBar';
import { ResourceStatusIcon } from '../components/ui/ResourceStatusIcon';
import { resourceStatusInput } from '../lib/resource-status';
import type { BootstrapPermissions } from '../lib/bootstrap';
import { domainApi, type CoreAction, type CoreResource, type CoreResourceType } from '../lib/domain-api';
import { parseResourceStatus } from '../lib/resource-status';
import { useApiQuery } from '../lib/use-api-query';
import { navigateTo, useNavigate } from '../lib/use-navigate';

type CoreResourcesPageProps = {
    type: CoreResourceType;
    permissions: BootstrapPermissions;
    embedded?: boolean;
    legacyBaseUrl?: string;
    initialResourceUuid?: string | null;
};

const labels: Record<CoreResourceType, string> = {
    servers: 'Serveurs',
    applications: 'Applications',
    databases: 'Bases de données',
    services: 'Services',
};

const actionLabels: Record<CoreAction, string> = {
    start: 'Démarrer',
    stop: 'Arrêter',
    restart: 'Redémarrer',
    deploy: 'Déployer',
};

const actionIcons = {
    start: Play,
    stop: Square,
    restart: RotateCw,
    deploy: Rocket,
};

function databaseCardTitle(resource: CoreResource): string {
    const applications = resource.connected_applications ?? [];
    if (applications.length === 0) {
        return 'Sans application';
    }

    return applications.map((application) => application.application_name).join(', ');
}

function databaseCardSubtitle(resource: CoreResource): string {
    const engineLabel = resource.engine_label ?? resource.engine ?? 'Base de données';
    const status = parseResourceStatus(resource.status).shortLabel;

    return `${engineLabel} · ${status}`;
}

function resourceSearchHaystack(resource: CoreResource, resourceType: CoreResourceType): string {
    const values = [resource.name, resource.uuid];

    if (resourceType === 'databases') {
        values.push(resource.engine ?? '', resource.engine_label ?? '');
        values.push(...(resource.connected_applications ?? []).map((application) => application.application_name));
    }

    return values.join(' ').toLowerCase();
}

function ResourceDetail({ type, uuid, canAct, onClose, onChanged }: {
    type: CoreResourceType;
    uuid: string;
    canAct: boolean;
    onClose: () => void;
    onChanged: () => Promise<void>;
}) {
    const query = useApiQuery(`core:${type}:${uuid}`, () => domainApi.coreResource(type, uuid));
    const [acting, setActing] = useState<CoreAction | null>(null);
    const [pendingAction, setPendingAction] = useState<CoreAction | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);
    const resource = query.data?.data;

    const runAction = async (action: CoreAction) => {
        if (!resource || type === 'servers') return;
        setActing(action);
        setActionError(null);
        try {
            await domainApi.coreAction(type, resource.uuid, action);
            await query.reload();
            await onChanged();
        } catch {
            setActionError(`L’action « ${actionLabels[action]} » a échoué.`);
        } finally {
            setActing(null);
            setPendingAction(null);
        }
    };

    return (
        <>
            <Card title="Détail de la ressource">
                <DataState loading={query.loading} error={query.error} onRetry={() => void query.reload()}>
                    {resource && (
                        <div class="grid gap-3">
                            <div class="flex flex-wrap items-center justify-between gap-2">
                                <div>
                                    <p class="text-sm font-semibold">{resource.name}</p>
                                    <p class="font-mono text-[11px] text-base-content/45">{resource.uuid}</p>
                                </div>
                                <ResourceStatusIcon status={resourceStatusInput(resource)} />
                            </div>
                            {resource.description && <p class="text-xs text-base-content/60">{resource.description}</p>}
                            {resource.engine && <p class="text-xs">Moteur : <span class="font-medium">{resource.engine}</span></p>}
                            {Object.keys(resource.configuration).length > 0 && (
                                <dl class="grid gap-1 rounded-sm border border-base-300 p-3 text-xs">
                                    {Object.entries(resource.configuration).slice(0, 8).map(([key, value]) => (
                                        <div class="grid grid-cols-[8rem_1fr] gap-2" key={key}>
                                            <dt class="text-base-content/50">{key}</dt>
                                            <dd class="truncate font-mono">{typeof value === 'object' ? JSON.stringify(value) : String(value)}</dd>
                                        </div>
                                    ))}
                                </dl>
                            )}
                            {actionError && <p class="text-xs text-error" role="alert">{actionError}</p>}
                            <div class="flex flex-wrap gap-2">
                                {canAct && type !== 'servers' && resource.actions.map((action) => {
                                    const Icon = actionIcons[action];
                                    return (
                                        <button
                                            class="btn btn-sm"
                                            type="button"
                                            disabled={acting !== null}
                                            key={action}
                                            onClick={() => {
                                                if (['stop', 'restart', 'deploy'].includes(action)) {
                                                    setPendingAction(action);
                                                    return;
                                                }
                                                void runAction(action);
                                            }}
                                        >
                                            <Icon class="size-3.5" aria-hidden />
                                            {acting === action ? 'En cours…' : actionLabels[action]}
                                        </button>
                                    );
                                })}
                                <button class="btn btn-ghost btn-sm ms-auto" type="button" onClick={onClose}>Fermer</button>
                            </div>
                        </div>
                    )}
                </DataState>
            </Card>

            {resource && pendingAction && (
                <ConfirmDialog
                    open
                    title={actionLabels[pendingAction]}
                    message={`Confirmer « ${actionLabels[pendingAction]} » sur « ${resource.name} » ?`}
                    tone="danger"
                    loading={acting === pendingAction}
                    onCancel={() => setPendingAction(null)}
                    onConfirm={() => void runAction(pendingAction)}
                />
            )}
        </>
    );
}

export function CoreResourcesPage({ type, permissions, embedded = false, legacyBaseUrl = '', initialResourceUuid = null }: CoreResourcesPageProps) {
    const onNavigate = useNavigate();
    const query = useApiQuery(`core:${type}`, () => domainApi.coreResources(type));
    const [selectedUuid, setSelectedUuid] = useState<string | null>(initialResourceUuid);
    const [search, setSearch] = useState('');
    const [createModalOpen, setCreateModalOpen] = useState(false);
    const resources = query.data?.data ?? [];

    useEffect(() => {
        setSearch('');
        if (initialResourceUuid) {
            setSelectedUuid(initialResourceUuid);
            return;
        }
        setSelectedUuid(null);
    }, [type, initialResourceUuid]);

    const closeDetail = () => {
        setSelectedUuid(null);
        if (initialResourceUuid && type === 'applications') {
            navigateTo('/applications');
        }
    };

    const filtered = useMemo(() => {
        const normalized = search.trim().toLowerCase();
        if (!normalized) return resources;
        return resources.filter((resource) => resourceSearchHaystack(resource, type).includes(normalized));
    }, [resources, search, type]);

    const activeUuid = useMemo(() => {
        if (!selectedUuid) {
            return null;
        }

        if (type === 'applications' || type === 'databases') {
            return selectedUuid;
        }

        return resources.some((resource) => resource.uuid === selectedUuid) ? selectedUuid : null;
    }, [resources, selectedUuid, type]);

    return (
        <>
            {!embedded && (
                <Breadcrumbs
                    items={[
                        { label: 'DevForge', href: '/' },
                        { label: labels[type] },
                    ]}
                    onNavigate={onNavigate}
                />
            )}
            {!embedded && (
                <PageHeader
                    title={labels[type]}
                    description="Données et actions fournies par l’API core."
                    actions={(
                        <>
                            {type === 'applications' && permissions.create_resources && (
                                <button class="btn btn-primary btn-sm" type="button" onClick={() => setCreateModalOpen(true)}>
                                    <Plus class="size-3.5" aria-hidden />
                                    Nouvelle application
                                </button>
                            )}
                            {type === 'databases' && permissions.create_resources && (
                                <button class="btn btn-primary btn-sm" type="button" onClick={() => setCreateModalOpen(true)}>
                                    <Plus class="size-3.5" aria-hidden />
                                    Nouvelle base
                                </button>
                            )}
                            <button class="btn btn-ghost btn-sm" type="button" onClick={() => void query.reload()}>
                                <RefreshCw class="size-3.5" aria-hidden />
                                Actualiser
                            </button>
                        </>
                    )}
                />
            )}
            {embedded && (
                <div class="flex items-center justify-between gap-2">
                    <p class="text-xs text-base-content/55">Hôtes, connexions et proxy de l’équipe active.</p>
                    <button class="btn btn-ghost btn-sm" type="button" onClick={() => void query.reload()}>
                        <RefreshCw class="size-3.5" aria-hidden />
                        Actualiser
                    </button>
                </div>
            )}

            {!(activeUuid && (type === 'applications' || type === 'databases')) && (
                <FilterBar query={search} onQueryChange={setSearch} placeholder={`Rechercher un ${labels[type].slice(0, -1).toLowerCase()}…`} />
            )}

            {activeUuid && type === 'applications' ? (
                <ApplicationDetailPanel
                    uuid={activeUuid}
                    canAct={permissions.create_resources}
                    onClose={closeDetail}
                    onChanged={query.reload}
                />
            ) : activeUuid && type === 'databases' ? (
                <DatabaseDetailPanel
                    uuid={activeUuid}
                    canAct={permissions.create_resources}
                    onClose={closeDetail}
                    onChanged={query.reload}
                />
            ) : (
                <>
                    {activeUuid && (
                        <ResourceDetail
                            type={type}
                            uuid={activeUuid}
                            canAct={permissions.create_resources}
                            onClose={() => setSelectedUuid(null)}
                            onChanged={query.reload}
                        />
                    )}

                    <DataState
                        loading={query.loading}
                        error={query.error}
                        empty={filtered.length === 0}
                        emptyMessage={`Aucune ressource « ${labels[type].toLowerCase()} ».`}
                        onRetry={() => void query.reload()}
                    >
                        <div class="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                            {filtered.map((resource) => (
                                <button
                                    class={`rounded-2xl border bg-base-100 p-4 text-left shadow-sm transition hover:border-primary/30 hover:shadow-md focus-visible:ring-2 focus-visible:ring-primary ${
                                        activeUuid === resource.uuid ? 'border-primary/40 ring-1 ring-primary/15' : 'border-base-300/70'
                                    }`}
                                    type="button"
                                    key={resource.uuid}
                                    onClick={() => setSelectedUuid(resource.uuid)}
                                >
                                    <div class="mb-2 flex items-start justify-between gap-2">
                                        <div class="min-w-0">
                                            {type === 'databases' ? (
                                                <>
                                                    <p class="truncate text-sm font-semibold">{databaseCardTitle(resource)}</p>
                                                    <p class="text-[11px] text-base-content/55">{databaseCardSubtitle(resource)}</p>
                                                </>
                                            ) : (
                                                <>
                                                    <p class="truncate text-sm font-semibold">{resource.name}</p>
                                                    <p class="text-[11px] uppercase tracking-wide text-base-content/45">{resource.type}</p>
                                                </>
                                            )}
                                        </div>
                                        <ResourceStatusIcon status={resourceStatusInput(resource)} />
                                    </div>
                                    <span class="inline-flex items-center gap-1 text-xs text-primary">
                                        <Eye class="size-3.5" aria-hidden />
                                        Voir le détail
                                    </span>
                                </button>
                            ))}
                        </div>
                    </DataState>
                </>
            )}
            {type === 'applications' && (
                <CreateApplicationModal
                    open={createModalOpen}
                    legacyBaseUrl={legacyBaseUrl}
                    onClose={() => setCreateModalOpen(false)}
                    onCreated={(applicationUuid) => {
                        void query.reload();
                        setSelectedUuid(applicationUuid);
                    }}
                />
            )}
            {type === 'databases' && (
                <CreateDatabaseModal
                    open={createModalOpen}
                    onClose={() => setCreateModalOpen(false)}
                    onCreated={(databaseUuid) => {
                        void query.reload();
                        setSelectedUuid(databaseUuid);
                    }}
                />
            )}
        </>
    );
}
