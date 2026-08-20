import { Play, Plus, RefreshCw, RotateCw, Rocket, Square } from 'lucide-preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { ApplicationBootSequenceBanner } from '../../components/applications/ApplicationBootSequenceBanner';
import { ApplicationDetailPanel } from '../../components/applications/ApplicationDetailPanel';
import { ApplicationLogo } from '../../components/applications/ApplicationLogo';
import { CreateApplicationModal } from '../../components/applications/CreateApplicationModal';
import { CreateDatabaseModal } from '../../components/databases/CreateDatabaseModal';
import { DatabaseDetailPanel } from '../../components/databases/DatabaseDetailPanel';
import { ServiceDetailPanel } from '../../components/services/ServiceDetailPanel';
import { PageHeader } from '../../components/PageHeader';
import { ActionToolbar } from '../../components/ui/ActionToolbar';
import { Breadcrumbs } from '../../components/ui/Breadcrumbs';
import { Card } from '../../components/ui/Card';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { DataState } from '../../components/ui/DataState';
import { FilterBar } from '../../components/ui/FilterBar';
import { ResourceCard } from '../../components/ui/ResourceCard';
import { ResourceStatusIcon } from '../../components/ui/ResourceStatusIcon';
import { StatCard } from '../../components/ui/StatCard';
import { resourceStatusInput } from '../../lib/resource-status';
import { resolveCoreResourceActions } from '../../lib/core-resource-actions';
import type { BootstrapPermissions } from '../../lib/bootstrap';
import {
    domainApi,
    type ApplicationBootSequenceItem,
    type CoreAction,
    type CoreResource,
    type CoreResourceType,
} from '../../lib/domain-api';
import { applicationPath, parseApplicationTab, type ApplicationTabId } from '../../lib/application-tabs';
import {
    databasePath,
    parseDatabaseTab,
    parseServiceTab,
    servicePath,
    type DatabaseDetailTabId,
    type ServiceDetailTabId,
} from '../../lib/routes';
import { parseResourceStatus } from '../../lib/resource-status';
import { useApplicationBootSequence } from '../../lib/hooks/use-application-boot-sequence';
import { useApiQuery } from '../../lib/use-api-query';
import { navigateTo, useNavigate } from '../../lib/use-navigate';
import { sanitizeResourceUuid } from '../../lib/route-path';

function bootPhaseForResource(
    resourceUuid: string,
    items: ApplicationBootSequenceItem[],
    bootActive: boolean,
): ApplicationBootSequenceItem['phase'] | null {
    if (!bootActive) {
        return null;
    }

    return items.find((item) => item.uuid === resourceUuid)?.phase ?? null;
}

function bootCardClass(phase: ApplicationBootSequenceItem['phase'] | null): string {
    if (phase === null) {
        return '';
    }

    if (phase === 'waiting') {
        return 'application-boot-card application-boot-card--waiting';
    }

    if (phase === 'starting') {
        return 'application-boot-card application-boot-card--starting';
    }

    if (phase === 'running') {
        return 'application-boot-card application-boot-card--running';
    }

    if (phase === 'failed') {
        return 'application-boot-card application-boot-card--failed';
    }

    return 'application-boot-card';
}

function readUuidDeepLink(): string | null {
    if (typeof window === 'undefined') {
        return null;
    }

    return sanitizeResourceUuid(new URLSearchParams(window.location.search).get('uuid'));
}

function readDatabaseDeepLink(): { uuid: string | null; tab: DatabaseDetailTabId } {
    if (typeof window === 'undefined') {
        return { uuid: null, tab: 'overview' };
    }

    const params = new URLSearchParams(window.location.search);

    return {
        uuid: sanitizeResourceUuid(params.get('uuid')),
        tab: parseDatabaseTab(params.get('tab')),
    };
}

function readServiceDeepLink(): { uuid: string | null; tab: ServiceDetailTabId } {
    if (typeof window === 'undefined') {
        return { uuid: null, tab: 'overview' };
    }

    const params = new URLSearchParams(window.location.search);

    return {
        uuid: sanitizeResourceUuid(params.get('uuid')),
        tab: parseServiceTab(params.get('tab')),
    };
}

function readApplicationTabDeepLink(): ApplicationTabId {
    if (typeof window === 'undefined') {
        return 'overview';
    }

    return parseApplicationTab(new URLSearchParams(window.location.search).get('tab'));
}

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

const descriptions: Record<CoreResourceType, string> = {
    servers: 'Hôtes SSH, proxy et destinations de déploiement.',
    applications: 'Santé, déploiements et accès rapide à vos apps.',
    databases: 'Instances, connexions et sauvegardes.',
    services: 'Stacks et services gérés.',
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

    if (/^libsql-database-[a-z0-9]+$/i.test(resource.name) && applications.length > 0) {
        return applications.length === 1
            ? `Base de ${applications[0].application_name}`
            : applications.map((application) => application.application_name).join(', ');
    }

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
                            <ActionToolbar>
                                {canAct && type !== 'servers' && resolveCoreResourceActions(resource).map((action) => {
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
                                <button class="btn btn-ghost btn-sm sm:ms-auto" type="button" onClick={onClose}>Fermer</button>
                            </ActionToolbar>
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
    const databaseDeepLink = type === 'databases' ? readDatabaseDeepLink() : { uuid: null, tab: 'overview' as DatabaseDetailTabId };
    const serviceDeepLink = type === 'services' ? readServiceDeepLink() : { uuid: null, tab: 'overview' as ServiceDetailTabId };
    const query = useApiQuery(`core:${type}`, () => domainApi.coreResources(type));
    const bootSequence = useApplicationBootSequence(type === 'applications');
    const [selectedUuid, setSelectedUuid] = useState<string | null>(
        initialResourceUuid
        ?? (type === 'databases' ? databaseDeepLink.uuid : null)
        ?? (type === 'services' ? serviceDeepLink.uuid : null)
        ?? readUuidDeepLink(),
    );
    const [databaseInitialTab, setDatabaseInitialTab] = useState<DatabaseDetailTabId>(databaseDeepLink.tab);
    const [serviceInitialTab, setServiceInitialTab] = useState<ServiceDetailTabId>(serviceDeepLink.tab);
    const [applicationInitialTab, setApplicationInitialTab] = useState<ApplicationTabId>(() => (
        type === 'applications' ? readApplicationTabDeepLink() : 'overview'
    ));
    const [search, setSearch] = useState('');
    const [createModalOpen, setCreateModalOpen] = useState(false);
    const [startAllOpen, setStartAllOpen] = useState(false);
    const [startAllLoading, setStartAllLoading] = useState(false);
    const [startAllError, setStartAllError] = useState<string | null>(null);
    const loadedResources = query.data?.data ?? [];
    const resources = useMemo(() => {
        if (loadedResources.length > 0 || type !== 'applications' || !bootSequence.active) {
            return loadedResources;
        }

        return bootSequence.items.map((item): CoreResource => ({
            uuid: item.uuid,
            type: 'application',
            name: item.name,
            description: null,
            status: item.status || 'starting:unknown',
            configuration: {},
            actions: [],
            created_at: null,
            updated_at: null,
        }));
    }, [bootSequence.active, bootSequence.items, loadedResources, type]);
    const bootReloadKeyRef = useRef('');

    const stoppedApplicationsCount = useMemo(() => {
        if (type !== 'applications') {
            return 0;
        }

        return resources.filter((resource) => {
            const tone = parseResourceStatus(resource.status).tone;
            const raw = typeof resource.status === 'string' ? resource.status.toLowerCase() : '';

            return tone === 'error' && (
                raw.startsWith('exited')
                || raw.startsWith('stopped')
                || raw.startsWith('dead')
            );
        }).length;
    }, [resources, type]);

    const runStartAll = async () => {
        setStartAllLoading(true);
        setStartAllError(null);
        try {
            await domainApi.startApplicationBootSequence();
            bootSequence.reload();
            await query.reload({ silent: true });
            setStartAllOpen(false);
        } catch {
            setStartAllError('Impossible de démarrer toutes les applications.');
        } finally {
            setStartAllLoading(false);
        }
    };

    useEffect(() => {
        if (type !== 'applications' || !bootSequence.active || query.loading || loadedResources.length === 0) {
            return;
        }

        const key = `${bootSequence.current_uuid ?? ''}:${bootSequence.completed}`;
        if (bootReloadKeyRef.current === '') {
            bootReloadKeyRef.current = key;
            return;
        }
        if (bootReloadKeyRef.current === key) {
            return;
        }

        bootReloadKeyRef.current = key;
        void query.reload({ silent: true });
    }, [type, bootSequence.active, bootSequence.completed, bootSequence.current_uuid, query.loading, loadedResources.length, query.reload]);

    useEffect(() => {
        setSearch('');
        if (type === 'databases') {
            const link = readDatabaseDeepLink();
            setSelectedUuid(initialResourceUuid ?? link.uuid);
            setDatabaseInitialTab(link.tab);
            return;
        }

        if (type === 'services') {
            const link = readServiceDeepLink();
            setSelectedUuid(initialResourceUuid ?? link.uuid);
            setServiceInitialTab(link.tab);
            return;
        }

        if (type === 'applications') {
            setSelectedUuid(initialResourceUuid);
            setApplicationInitialTab(readApplicationTabDeepLink());
            return;
        }

        if (initialResourceUuid) {
            setSelectedUuid(initialResourceUuid);
            return;
        }
        setSelectedUuid(null);
    }, [type, initialResourceUuid]);

    const openApplication = (uuid: string, tab: ApplicationTabId = 'overview') => {
        setSelectedUuid(uuid);
        setApplicationInitialTab(tab);
        navigateTo(applicationPath(uuid, tab));
    };

    const openDatabase = (uuid: string, tab: DatabaseDetailTabId = 'overview') => {
        setSelectedUuid(uuid);
        setDatabaseInitialTab(tab);
        navigateTo(databasePath(uuid, tab));
    };

    const openService = (uuid: string, tab: ServiceDetailTabId = 'overview') => {
        setSelectedUuid(uuid);
        setServiceInitialTab(tab);
        navigateTo(servicePath(uuid, tab));
    };

    const closeDetail = () => {
        setSelectedUuid(null);
        if (type === 'applications') {
            navigateTo('/applications');
            return;
        }
        if ((type === 'databases' || type === 'services') && typeof window !== 'undefined' && window.location.search) {
            navigateTo(type === 'databases' ? '/databases' : '/services');
        }
    };

    const filtered = useMemo(() => {
        const normalized = search.trim().toLowerCase();
        const list = !normalized
            ? resources
            : resources.filter((resource) => resourceSearchHaystack(resource, type).includes(normalized));

        if (type !== 'applications' || !bootSequence.active || bootSequence.items.length === 0) {
            return list;
        }

        const order = new Map(bootSequence.items.map((item) => [item.uuid, item.order]));
        return [...list].sort((left, right) => (order.get(left.uuid) ?? 999) - (order.get(right.uuid) ?? 999));
    }, [resources, search, type, bootSequence.active, bootSequence.items]);

    const healthSummary = useMemo(() => {
        const parsed = resources.map((resource) => parseResourceStatus(resource.status));

        return {
            total: resources.length,
            running: parsed.filter(({ tone }) => tone === 'success').length,
            degraded: parsed.filter(({ tone }) => tone === 'warning').length,
            stopped: parsed.filter(({ tone }) => tone === 'error').length,
        };
    }, [resources]);

    const activeUuid = useMemo(() => {
        const candidate = sanitizeResourceUuid(selectedUuid);

        if (!candidate) {
            return null;
        }

        if (type === 'applications' || type === 'databases' || type === 'services') {
            return candidate;
        }

        return resources.some((resource) => resource.uuid === candidate) ? candidate : null;
    }, [resources, selectedUuid, type]);

    const isFullPageDetail = Boolean(activeUuid && (type === 'applications' || type === 'databases' || type === 'services'));

    return (
        <>
            {!embedded && !isFullPageDetail && (
                <Breadcrumbs
                    items={[
                        { label: 'DevForge', href: '/' },
                        { label: labels[type] },
                    ]}
                    onNavigate={onNavigate}
                />
            )}
            {!embedded && !isFullPageDetail && (
                <PageHeader
                    title={labels[type]}
                    description={descriptions[type]}
                    actions={(
                        <>
                            {type === 'applications' && permissions.create_resources && resources.length > 0 && (
                                <button
                                    class="btn btn-secondary btn-sm"
                                    type="button"
                                    disabled={bootSequence.active || startAllLoading}
                                    onClick={() => {
                                        setStartAllError(null);
                                        setStartAllOpen(true);
                                    }}
                                >
                                    <Play class="size-3.5" aria-hidden />
                                    {bootSequence.active ? 'Démarrage en cours…' : 'Démarrer toutes'}
                                </button>
                            )}
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
            {embedded && !isFullPageDetail && (
                <div class="toolbar-row">
                    <p class="text-xs text-base-content/55">Hôtes, connexions et proxy de l’équipe active.</p>
                    <div class="card-toolbar w-full sm:w-auto">
                        <button class="btn btn-ghost btn-sm w-full sm:w-auto" type="button" onClick={() => void query.reload()}>
                            <RefreshCw class="size-3.5" aria-hidden />
                            Actualiser
                        </button>
                    </div>
                </div>
            )}

            {!isFullPageDetail && (
                <FilterBar query={search} onQueryChange={setSearch} placeholder={`Rechercher un ${labels[type].slice(0, -1).toLowerCase()}…`} />
            )}

            {activeUuid && type === 'applications' ? (
                <ApplicationDetailPanel
                    uuid={activeUuid}
                    canAct={permissions.create_resources}
                    initialTab={applicationInitialTab}
                    onClose={closeDetail}
                    onChanged={query.reload}
                    onTabChange={(tab) => navigateTo(applicationPath(activeUuid, tab))}
                />
            ) : activeUuid && type === 'databases' ? (
                <DatabaseDetailPanel
                    uuid={activeUuid}
                    canAct={permissions.create_resources}
                    initialTab={databaseInitialTab}
                    onClose={closeDetail}
                    onChanged={query.reload}
                    onTabChange={(tab) => navigateTo(databasePath(activeUuid, tab))}
                />
            ) : activeUuid && type === 'services' ? (
                <ServiceDetailPanel
                    uuid={activeUuid}
                    canAct={permissions.create_resources}
                    initialTab={serviceInitialTab}
                    onClose={closeDetail}
                    onChanged={query.reload}
                    onTabChange={(tab) => navigateTo(servicePath(activeUuid, tab))}
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

                    {type === 'applications' && bootSequence.active && (
                        <ApplicationBootSequenceBanner
                            sequence={{
                                active: bootSequence.active,
                                status: bootSequence.status,
                                started_at: bootSequence.started_at,
                                finished_at: bootSequence.finished_at,
                                current_uuid: bootSequence.current_uuid,
                                completed: bootSequence.completed,
                                total: bootSequence.total,
                                poll_interval_ms: bootSequence.poll_interval_ms,
                                items: bootSequence.items,
                            }}
                        />
                    )}

                    {healthSummary.total > 0 && (
                        <div class="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                            <StatCard label="Total" value={healthSummary.total} hint={labels[type]} />
                            <StatCard label="En ligne" value={healthSummary.running} tone="success" hint="Sains" />
                            <StatCard label="Attention" value={healthSummary.degraded} tone={healthSummary.degraded > 0 ? 'warning' : 'default'} hint="Dégradés" />
                            <StatCard label="Arrêtés" value={healthSummary.stopped} tone={healthSummary.stopped > 0 ? 'error' : 'default'} hint="Hors ligne" />
                        </div>
                    )}

                    <DataState
                        loading={query.loading && resources.length === 0}
                        error={query.error}
                        empty={filtered.length === 0}
                        emptyMessage={`Aucune ressource « ${labels[type].toLowerCase()} ».`}
                        onRetry={() => void query.reload()}
                    >
                        <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                            {filtered.map((resource) => {
                                const bootPhase = type === 'applications'
                                    ? bootPhaseForResource(resource.uuid, bootSequence.items, bootSequence.active)
                                    : null;
                                const bootItem = bootSequence.items.find((item) => item.uuid === resource.uuid);
                                const statusInput = bootPhase === 'starting'
                                    ? 'starting:unknown'
                                    : bootPhase === 'waiting'
                                        ? 'created:unknown'
                                        : resourceStatusInput(resource);

                                return (
                                <ResourceCard
                                    key={resource.uuid}
                                    title={type === 'databases' ? databaseCardTitle(resource) : resource.name}
                                    subtitle={type === 'databases' ? databaseCardSubtitle(resource) : resource.type}
                                    status={statusInput}
                                    selected={activeUuid === resource.uuid}
                                    class={bootCardClass(bootPhase)}
                                    style={bootItem && bootSequence.active
                                        ? { animationDelay: `${Math.min(bootItem.order, 12) * 70}ms` }
                                        : undefined}
                                    logo={type === 'applications'
                                        ? (
                                            <ApplicationLogo
                                                name={resource.name}
                                                configuration={resource.configuration}
                                            />
                                        )
                                        : undefined}
                                    onClick={() => {
                                        if (type === 'applications') {
                                            openApplication(resource.uuid);
                                            return;
                                        }
                                        if (type === 'databases') {
                                            openDatabase(resource.uuid);
                                            return;
                                        }
                                        if (type === 'services') {
                                            openService(resource.uuid);
                                            return;
                                        }
                                        setSelectedUuid(resource.uuid);
                                    }}
                                />
                                );
                            })}
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
                        openApplication(applicationUuid);
                    }}
                />
            )}
            {type === 'applications' && (
                <ConfirmDialog
                    open={startAllOpen}
                    title="Démarrer toutes les applications"
                    message={
                        <>
                            <p>
                                {stoppedApplicationsCount > 0
                                    ? `Lancer le démarrage séquentiel de toutes les applications ? ${stoppedApplicationsCount} application${stoppedApplicationsCount > 1 ? 's' : ''} actuellement arrêtée${stoppedApplicationsCount > 1 ? 's' : ''} seront redémarrées.`
                                    : 'Lancer le démarrage séquentiel de toutes les applications ? Les applications déjà en cours seront vérifiées, les autres démarrées une par une.'}
                            </p>
                            {startAllError && <p class="text-error" role="alert">{startAllError}</p>}
                        </>
                    }
                    confirmLabel="Démarrer toutes"
                    tone="primary"
                    loading={startAllLoading}
                    onCancel={() => {
                        if (!startAllLoading) {
                            setStartAllOpen(false);
                            setStartAllError(null);
                        }
                    }}
                    onConfirm={() => void runStartAll()}
                />
            )}
            {type === 'databases' && (
                <CreateDatabaseModal
                    open={createModalOpen}
                    onClose={() => setCreateModalOpen(false)}
                    onCreated={(databaseUuid) => {
                        void query.reload();
                        openDatabase(databaseUuid);
                    }}
                />
            )}
        </>
    );
}
