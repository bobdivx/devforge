import {
    ArrowLeft,
    ChevronDown,
    CircleAlert,
    ExternalLink,
    FileText,
    GitBranch,
    Globe,
    Loader2,
    Play,
    RefreshCw,
    Rocket,
    RotateCw,
    Server,
    Square,
    XCircle,
} from 'lucide-preact';
import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { ActionToolbar } from '../ui/ActionToolbar';
import { DataState } from '../ui/DataState';
import { DeploymentStatusIcon } from '../ui/DeploymentStatusIcon';
import { ResourceStatusIcon } from '../ui/ResourceStatusIcon';
import { Tabs } from '../ui/Tabs';
import { ApplicationAgentChatCard } from './ApplicationAgentChatCard';
import { ApplicationDomainsPanel } from './ApplicationDomainsPanel';
import { ApplicationDangerPanel } from './ApplicationDangerPanel';
import { ApplicationReadinessCard } from './ApplicationReadinessCard';
import { ApplicationRuntimeSettingsPanel } from './ApplicationRuntimeSettingsPanel';
import { ApplicationEnvironmentVariablesPanel } from './ApplicationEnvironmentVariablesPanel';
import { ApplicationStatusBadges } from './ApplicationStatusBadges';
import { ConnectDatabasePanel } from './ConnectDatabasePanel';
import { ApplicationLogsPanel } from './ApplicationLogsPanel';
import { DeploymentMonitorPanel } from './DeploymentMonitorPanel';
import { ApplicationSourceExplorer } from './ApplicationSourceExplorer';
import {
    formatDateTime,
    latestDeployment,
    parseApplicationConfiguration,
    primaryDomain,
    relativeUpdatedAt,
    repositoryLabel,
    resolvePreviewAvailability,
    shortCommit,
    shouldPollApplicationReadiness,
    visitUrl,
    websiteScreenshotUrl,
} from '../../lib/application-config';
import { applicationTabs, type ApplicationTabId } from '../../lib/application-tabs';
import { canVisitApplication, resolveCoreResourceActions } from '../../lib/core-resource-actions';
import { domainApi, type ApplicationReadiness, type CoreAction } from '../../lib/domain-api';
import { isDeploymentActive } from '../../lib/deployment-status';
import { pickFocusedDeployment } from '../../lib/pick-focused-deployment';
import { partitionDeploymentAttempts } from '../../lib/partition-deployment-attempts';
import { shouldCollapsePreviousFailures } from '../../lib/agent-correction-summary';
import { useApiQuery } from '../../lib/use-api-query';
import type { Deployment } from '../../lib/domain-api';

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

type DetailRowProps = {
    label: string;
    children: ComponentChildren;
};

function DetailRow({ label, children }: DetailRowProps) {
    return (
        <div class="grid gap-1 border-b border-base-300/50 py-3 last:border-b-0 sm:grid-cols-[7.5rem_1fr] sm:gap-4">
            <dt class="text-xs font-medium uppercase tracking-wide text-base-content/45">{label}</dt>
            <dd class="min-w-0 text-sm">{children}</dd>
        </div>
    );
}

type AttemptTone = 'current' | 'active' | 'failed' | 'history';

function DeploymentAttemptGroup({
    title,
    hint,
    tone,
    deployments,
    focusedUuid,
    onSelect,
    collapsible = false,
    defaultCollapsed = false,
}: {
    title: string;
    hint: string;
    tone: AttemptTone;
    deployments: Deployment[];
    focusedUuid: string | null;
    onSelect: (uuid: string) => void;
    collapsible?: boolean;
    defaultCollapsed?: boolean;
}) {
    const [open, setOpen] = useState(!defaultCollapsed);
    const toneClass = {
        current: 'border-primary/35 bg-primary/5',
        active: 'border-warning/30 bg-warning/5',
        failed: 'border-error/25 bg-error/5',
        history: 'border-base-300/70 bg-base-200/30',
    }[tone];

    const header = (
        <div class="flex min-w-0 items-start justify-between gap-2">
            <div class="min-w-0">
                <p class="flex flex-wrap items-center gap-2 text-sm font-semibold">
                    <span>{title}</span>
                    {collapsible && (
                        <span class="rounded-full border border-base-300/70 bg-base-100 px-2 py-0.5 text-[11px] font-medium text-base-content/60">
                            {deployments.length}
                        </span>
                    )}
                </p>
                <p class="text-xs text-base-content/50">{hint}</p>
            </div>
            {collapsible && (
                <ChevronDown
                    class={`mt-0.5 size-4 shrink-0 text-base-content/45 transition ${open ? 'rotate-180' : ''}`}
                    aria-hidden
                />
            )}
        </div>
    );

    return (
        <div class={`min-w-0 overflow-hidden rounded-xl border ${toneClass} p-3`}>
            {collapsible ? (
                <button
                    type="button"
                    class="mb-0 w-full min-w-0 text-left"
                    aria-expanded={open}
                    onClick={() => setOpen((value) => !value)}
                >
                    {header}
                </button>
            ) : (
                <div class="mb-2 min-w-0">{header}</div>
            )}
            {(!collapsible || open) && (
                <ul class={`grid min-w-0 gap-2 ${collapsible ? 'mt-3' : ''}`}>
                    {deployments.map((deployment) => {
                        const selected = deployment.uuid === focusedUuid;

                        return (
                            <li key={deployment.uuid} class="min-w-0">
                                <button
                                    class={`flex w-full min-w-0 flex-col gap-2 rounded-lg border px-3 py-2 text-left transition sm:flex-row sm:items-center sm:justify-between ${
                                        selected
                                            ? 'border-primary/40 bg-base-100'
                                            : 'border-base-300/60 bg-base-100/80 hover:border-primary/30'
                                    }`}
                                    type="button"
                                    onClick={() => onSelect(deployment.uuid)}
                                >
                                    <span class="flex min-w-0 flex-1 flex-col gap-1 overflow-hidden">
                                        <span class="flex min-w-0 flex-wrap items-center gap-2">
                                            <DeploymentStatusIcon status={deployment.status} showLabel={selected || tone !== 'history'} />
                                            <span class="font-mono text-[11px] text-base-content/45">
                                                {shortCommit(deployment.commit) ?? '—'}
                                            </span>
                                        </span>
                                        <span class="truncate text-sm text-base-content/70">
                                            {deployment.commit_message ?? 'Sans message de commit'}
                                        </span>
                                        <span class="text-xs text-base-content/45">
                                            {formatDateTime(deployment.finished_at ?? deployment.created_at)}
                                        </span>
                                    </span>
                                    <span class={`btn btn-ghost btn-xs shrink-0 ${selected ? 'text-primary' : ''}`}>
                                        <FileText class="size-3.5" aria-hidden />
                                        {selected ? 'Actif' : 'Logs'}
                                    </span>
                                </button>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}

function PreviewPanel({
    name,
    domain,
    status,
    canVisit,
    readiness,
    readinessLoading,
}: {
    name: string;
    domain: string | null;
    status: string;
    canVisit: boolean;
    readiness: ApplicationReadiness | null;
    readinessLoading: boolean;
}) {
    const href = canVisit ? visitUrl(domain) : null;
    const screenshotUrl = websiteScreenshotUrl(domain);
    const [screenshotState, setScreenshotState] = useState<'loading' | 'loaded' | 'error'>(
        screenshotUrl ? 'loading' : 'error',
    );
    const initials = name
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part[0])
        .join('')
        .toUpperCase();
    const showPlaceholder = !screenshotUrl || screenshotState === 'error';
    const availability = resolvePreviewAvailability(status, readiness, readinessLoading);
    const OverlayIcon = availability.tone === 'error'
        ? XCircle
        : availability.label?.includes('Vérification') || availability.label?.includes('Récupération') || availability.label?.includes('Démarrage')
            ? Loader2
            : CircleAlert;
    const overlaySpin = OverlayIcon === Loader2;
    const overlayToneClass = availability.tone === 'error'
        ? 'border-error/40 bg-error/15 text-error'
        : availability.tone === 'warning'
            ? 'border-warning/40 bg-warning/15 text-warning'
            : 'border-base-300/70 bg-base-100/90 text-base-content/70';

    useEffect(() => {
        setScreenshotState(screenshotUrl ? 'loading' : 'error');
    }, [screenshotUrl]);

    return (
        <div class="relative overflow-hidden rounded-2xl border border-base-300/70 bg-base-200/50">
            {showPlaceholder ? (
                <div class="aspect-[4/3] flex flex-col items-center justify-center gap-3 p-6 text-center">
                    <div class="grid size-16 place-items-center rounded-2xl bg-base-100 text-xl font-bold shadow-sm">
                        {initials || 'A'}
                    </div>
                    <div>
                        <p class="text-sm font-semibold">{name}</p>
                        <p class="text-xs text-base-content/50">{domain ?? 'Aucun domaine configuré'}</p>
                    </div>
                    {!availability.ready && availability.label ? (
                        <div
                            class={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold ${overlayToneClass}`}
                            role="status"
                        >
                            <OverlayIcon class={`size-3.5 ${overlaySpin ? 'animate-spin' : ''}`} aria-hidden />
                            {availability.label}
                        </div>
                    ) : (
                        <ResourceStatusIcon status={status} />
                    )}
                </div>
            ) : (
                <div class="relative aspect-[4/3] bg-base-300/40">
                    {screenshotState === 'loading' && (
                        <div class="absolute inset-0 animate-pulse bg-base-300/70" aria-hidden />
                    )}
                    <img
                        alt={`Capture d’écran de ${name}`}
                        class={`size-full object-cover object-top transition-opacity duration-300 ${
                            screenshotState === 'loaded' ? 'opacity-100' : 'opacity-0'
                        } ${!availability.ready ? 'brightness-75 saturate-75' : ''}`}
                        decoding="async"
                        loading="lazy"
                        src={screenshotUrl}
                        onError={() => setScreenshotState('error')}
                        onLoad={() => setScreenshotState('loaded')}
                    />
                    {!availability.ready && availability.label && (
                        <div class="pointer-events-none absolute inset-0 flex items-center justify-center bg-base-300/35 p-4">
                            <div
                                class={`inline-flex max-w-[90%] items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-semibold shadow-sm backdrop-blur-sm ${overlayToneClass}`}
                                role="status"
                            >
                                <OverlayIcon class={`size-4 shrink-0 ${overlaySpin ? 'animate-spin' : ''}`} aria-hidden />
                                {availability.label}
                            </div>
                        </div>
                    )}
                    <div class="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-base-300/95 via-base-300/55 to-transparent px-4 pb-14 pt-12">
                        <p class="text-sm font-semibold text-base-content">{name}</p>
                        <p class="truncate text-xs text-base-content/70">{domain}</p>
                    </div>
                </div>
            )}
            {href && (
                <a
                    class="absolute inset-x-0 bottom-0 flex items-center justify-center gap-2 border-t border-base-300/70 bg-base-100/90 px-4 py-3 text-sm font-medium text-primary transition hover:bg-base-100"
                    href={href}
                    rel="noreferrer"
                    target="_blank"
                >
                    <ExternalLink class="size-4" aria-hidden />
                    Ouvrir l’aperçu
                </a>
            )}
        </div>
    );
}

type ApplicationDetailPanelProps = {
    uuid: string;
    canAct: boolean;
    onClose: () => void;
    onChanged: () => Promise<void>;
};

export function ApplicationDetailPanel({ uuid, canAct, onClose, onChanged }: ApplicationDetailPanelProps) {
    const resourceQuery = useApiQuery(`core:applications:${uuid}`, () => domainApi.coreResource('applications', uuid));
    const deploymentsQuery = useApiQuery(`deployments:${uuid}`, () => domainApi.deployments(1, uuid, 8));
    const readinessQuery = useApiQuery(`readiness:${uuid}`, () => domainApi.applicationReadiness(uuid));
    const [activeTab, setActiveTab] = useState<ApplicationTabId>('overview');
    const [acting, setActing] = useState<CoreAction | null>(null);
    const [pendingAction, setPendingAction] = useState<CoreAction | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);
    const [focusedDeploymentUuid, setFocusedDeploymentUuid] = useState<string | null>(null);
    const [focusPinned, setFocusPinned] = useState(false);

    const resource = resourceQuery.data?.data;
    const status = resource?.status ?? 'unknown';
    const config = resource ? parseApplicationConfiguration(resource.configuration) : null;
    const domain = config ? primaryDomain(config.domains) : null;
    const deployments = (deploymentsQuery.data?.data ?? []).filter(
        (deployment) => deployment.application?.uuid === uuid,
    );
    const latest = latestDeployment(deployments);
    const visit = canVisitApplication(status, domain) ? visitUrl(domain) : null;
    const availableActions = resource ? resolveCoreResourceActions(resource) : [];
    const selectedDeployment = deployments.find((deployment) => deployment.uuid === focusedDeploymentUuid) ?? null;
    const attemptBuckets = partitionDeploymentAttempts(deployments, focusedDeploymentUuid);
    const hasActiveDeployment = deployments.some((deployment) => isDeploymentActive(deployment.status));
    const readiness = readinessQuery.data?.data ?? null;

    const focusDeployment = (deploymentUuid: string, pinned = false) => {
        setFocusedDeploymentUuid(deploymentUuid);
        setFocusPinned(pinned);
    };

    useEffect(() => {
        setFocusedDeploymentUuid(null);
        setFocusPinned(false);
        setActiveTab('overview');
        setActing(null);
        setPendingAction(null);
        setActionError(null);
    }, [uuid]);

    useEffect(() => {
        setFocusedDeploymentUuid((current) => pickFocusedDeployment(deployments, current, { pinned: focusPinned }));
    }, [deployments, focusPinned]);
    useEffect(() => {
        if (!hasActiveDeployment) {
            return;
        }

        const interval = window.setInterval(() => {
            void deploymentsQuery.reload({ silent: true });
        }, 3000);

        return () => window.clearInterval(interval);
    }, [hasActiveDeployment, uuid, deploymentsQuery.reload]);

    useEffect(() => {
        if (!readiness || !shouldPollApplicationReadiness(readiness.status)) {
            return;
        }

        const interval = window.setInterval(() => {
            void readinessQuery.reload({ silent: true });
        }, 4000);

        return () => window.clearInterval(interval);
    }, [readiness?.status, uuid, readinessQuery.reload]);

    const openDeploymentsTab = () => {
        setFocusPinned(false);
        setActiveTab('deployments');
    };

    const reload = async () => {
        await Promise.all([resourceQuery.reload(), deploymentsQuery.reload(), readinessQuery.reload()]);
    };

    const runAction = async (action: CoreAction) => {
        if (!resource) {
            return;
        }

        setActing(action);
        setActionError(null);
        try {
            const response = await domainApi.coreAction('applications', resource.uuid, action);
            const deploymentUuid = typeof response.data?.deployment_uuid === 'string'
                ? response.data.deployment_uuid
                : null;

            if (deploymentUuid) {
                focusDeployment(deploymentUuid, false);
                openDeploymentsTab();
            }

            await reload();
            await onChanged();
        } catch {
            setActionError(`L’action « ${actionLabels[action]} » a échoué.`);
        } finally {
            setActing(null);
            setPendingAction(null);
        }
    };

    return (
        <DataState loading={resourceQuery.loading} error={resourceQuery.error} onRetry={() => void reload()}>
            {resource && config && (
                <div class="grid min-w-0 max-w-full gap-5 overflow-x-hidden">
                    <div class="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                        <div class="grid min-w-0 gap-2">
                            <button class="btn btn-ghost btn-sm -ms-2 w-fit rounded-full px-3" type="button" onClick={onClose}>
                                <ArrowLeft class="size-4" aria-hidden />
                                Applications
                            </button>
                            <div class="min-w-0">
                                <h2 class="break-words text-2xl font-bold tracking-tight sm:text-3xl">{resource.name}</h2>
                                <p class="break-words text-sm text-base-content/55">
                                    {[config.project?.name, config.environment?.name].filter(Boolean).join(' · ') || 'Application sans projet'}
                                </p>
                                <div class="mt-3">
                                    <ApplicationStatusBadges
                                        applicationUuid={uuid}
                                        resourceStatus={status}
                                        latestDeployment={latest}
                                        readiness={readiness}
                                        readinessLoading={readinessQuery.loading}
                                        onOpenTab={(tab) => {
                                            if (tab === 'deployments') {
                                                openDeploymentsTab();
                                                return;
                                            }
                                            setActiveTab(tab);
                                        }}
                                    />
                                </div>
                            </div>
                        </div>
                        <ActionToolbar class="w-full min-w-0 sm:w-auto">
                            {visit && (
                                <a class="btn btn-primary btn-sm rounded-full" href={visit} rel="noreferrer" target="_blank">
                                    <ExternalLink class="size-3.5" aria-hidden />
                                    Visiter
                                </a>
                            )}
                            {canAct && availableActions.map((action) => {
                                const Icon = actionIcons[action];
                                const primary = action === 'deploy';

                                return (
                                    <button
                                        class={`btn btn-sm rounded-full ${primary ? 'btn-primary' : 'btn-ghost border border-base-300/80'}`}
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
                            <button class="btn btn-ghost btn-sm rounded-full border border-base-300/80" type="button" onClick={() => void reload()}>
                                <RefreshCw class="size-3.5" aria-hidden />
                                Actualiser
                            </button>
                        </ActionToolbar>
                    </div>

                    <Tabs
                        items={applicationTabs}
                        active={activeTab}
                        onChange={(tabId) => {
                            const next = tabId as ApplicationTabId;
                            if (next === 'deployments') {
                                openDeploymentsTab();
                                return;
                            }
                            setActiveTab(next);
                        }}
                    />

                    {activeTab === 'overview' && (
                        <>
                            <section class="min-w-0 overflow-hidden rounded-2xl border border-base-300/70 bg-base-100 shadow-sm">
                                <div class="toolbar-row border-b border-base-300/70 px-4 py-4 sm:px-5">
                                    <div class="min-w-0">
                                        <p class="text-sm font-semibold">Production</p>
                                        <p class="text-xs text-base-content/50">
                                            Aperçu, domaines et source
                                            {latest
                                                ? ` · dernier déploiement ${relativeUpdatedAt(latest.finished_at ?? latest.created_at)}`
                                                : ''}
                                        </p>
                                    </div>
                                </div>

                                <div class="grid min-w-0 gap-5 p-4 sm:p-5 lg:grid-cols-[minmax(0,280px)_1fr]">
                                    <PreviewPanel
                                        name={resource.name}
                                        domain={domain}
                                        status={typeof status === 'string' ? status : 'running:healthy'}
                                        canVisit={visit !== null}
                                        readiness={readiness}
                                        readinessLoading={readinessQuery.loading}
                                    />

                                    <dl class="min-w-0 overflow-hidden">
                                        <DetailRow label="Domaines">
                                            {config.domains.length === 0 ? (
                                                <span class="text-base-content/45">Aucun domaine</span>
                                            ) : (
                                                <ul class="grid gap-2">
                                                    {config.domains.map((item) => {
                                                        const href = visitUrl(item);

                                                        return (
                                                            <li key={item}>
                                                                {href ? (
                                                                    <a class="inline-flex items-center gap-2 text-primary hover:underline" href={href} rel="noreferrer" target="_blank">
                                                                        <Globe class="size-3.5 shrink-0" aria-hidden />
                                                                        <span class="truncate">{item}</span>
                                                                        <ExternalLink class="size-3 shrink-0 opacity-60" aria-hidden />
                                                                    </a>
                                                                ) : (
                                                                    <span>{item}</span>
                                                                )}
                                                            </li>
                                                        );
                                                    })}
                                                </ul>
                                            )}
                                        </DetailRow>
                                        <DetailRow label="Source">
                                            <div class="grid gap-1">
                                                <span class="inline-flex items-center gap-2">
                                                    <GitBranch class="size-3.5 text-base-content/45" aria-hidden />
                                                    <span class="font-medium">{config.git_branch ?? 'branche inconnue'}</span>
                                                    {config.git_repository && (
                                                        <span class="truncate text-xs text-base-content/50">
                                                            {repositoryLabel(config.git_repository)}
                                                        </span>
                                                    )}
                                                </span>
                                                {latest?.commit && (
                                                    <span class="break-words font-mono text-xs text-base-content/55">
                                                        {shortCommit(latest.commit)}
                                                        {latest.commit_message ? ` · ${latest.commit_message}` : ''}
                                                    </span>
                                                )}
                                            </div>
                                        </DetailRow>
                                        <DetailRow label="Build">
                                            <span>
                                                {config.build_pack ?? '—'}
                                                {config.is_static ? ' · statique' : ''}
                                                {config.ports_exposes ? ` · port ${config.ports_exposes}` : ''}
                                            </span>
                                        </DetailRow>
                                        <DetailRow label="Infra">
                                            <span>
                                                {[config.server?.name, config.environment?.name].filter(Boolean).join(' · ') || '—'}
                                            </span>
                                        </DetailRow>
                                        <DetailRow label="Mis à jour">
                                            <span>{formatDateTime(resource.updated_at)}</span>
                                        </DetailRow>
                                    </dl>
                                </div>
                            </section>

                            <div class="flex flex-wrap gap-2">
                                <button
                                    class="btn btn-ghost btn-sm rounded-full border border-base-300/80"
                                    type="button"
                                    onClick={() => setActiveTab('settings')}
                                >
                                    Paramètres runtime
                                </button>
                                <button
                                    class="btn btn-ghost btn-sm rounded-full border border-base-300/80"
                                    type="button"
                                    onClick={openDeploymentsTab}
                                >
                                    <Rocket class="size-3.5" aria-hidden />
                                    Voir les déploiements
                                </button>
                                {config.server?.uuid && (
                                    <button
                                        class="btn btn-ghost btn-sm rounded-full border border-base-300/80"
                                        type="button"
                                        onClick={() => setActiveTab('files')}
                                    >
                                        <FileText class="size-3.5" aria-hidden />
                                        Code source
                                    </button>
                                )}
                            </div>

                            <ApplicationReadinessCard applicationUuid={uuid} canAct={canAct} />

                            <ApplicationAgentChatCard application={resource} />

                            {resource.description && (
                                <section class="rounded-2xl border border-base-300/70 bg-base-100 p-5 text-sm text-base-content/65 shadow-sm">
                                    {resource.description}
                                </section>
                            )}
                        </>
                    )}

                    {activeTab === 'deployments' && (
                        <>
                            <DataState
                                loading={deploymentsQuery.loading}
                                error={deploymentsQuery.error}
                                empty={deployments.length === 0}
                                emptyMessage="Aucun déploiement enregistré pour cette application."
                                onRetry={() => void deploymentsQuery.reload()}
                            >
                                <div class="grid min-w-0 gap-5">
                                    {(attemptBuckets.current || attemptBuckets.active.length > 0) && (
                                        <section class="min-w-0 overflow-hidden rounded-2xl border border-primary/25 bg-base-100 shadow-sm">
                                            <div class="toolbar-row border-b border-base-300/70 px-4 py-4 sm:px-5">
                                                <div class="min-w-0">
                                                    <p class="text-sm font-semibold">
                                                        {hasActiveDeployment ? 'Déploiement en cours' : 'Déploiement suivi'}
                                                    </p>
                                                    <p class="text-xs text-base-content/50">
                                                        Logs et agent pour la tentative sélectionnée
                                                    </p>
                                                </div>
                                                {selectedDeployment && (
                                                    <DeploymentStatusIcon status={selectedDeployment.status} showLabel />
                                                )}
                                            </div>

                                            <div class="grid min-w-0 gap-4 p-4 sm:p-5">
                                                {attemptBuckets.current && (
                                                    <DeploymentAttemptGroup
                                                        title="Sélection"
                                                        hint="Cette tentative alimente les logs ci-dessous"
                                                        tone="current"
                                                        deployments={[attemptBuckets.current]}
                                                        focusedUuid={focusedDeploymentUuid}
                                                        onSelect={(deploymentUuid) => focusDeployment(deploymentUuid, true)}
                                                    />
                                                )}
                                                {attemptBuckets.active.length > 0 && (
                                                    <DeploymentAttemptGroup
                                                        title="En file / en cours"
                                                        hint="Autres déploiements actifs"
                                                        tone="active"
                                                        deployments={attemptBuckets.active}
                                                        focusedUuid={focusedDeploymentUuid}
                                                        onSelect={(deploymentUuid) => focusDeployment(deploymentUuid, true)}
                                                    />
                                                )}

                                                {focusedDeploymentUuid && (selectedDeployment || deployments.length === 0) && (
                                                    <DeploymentMonitorPanel
                                                        deploymentUuid={focusedDeploymentUuid}
                                                        deployment={selectedDeployment}
                                                        onSelectDeployment={(deploymentUuid) => {
                                                            focusDeployment(deploymentUuid, true);
                                                            void deploymentsQuery.reload({ silent: true });
                                                        }}
                                                    />
                                                )}
                                            </div>
                                        </section>
                                    )}

                                    {!attemptBuckets.current && attemptBuckets.active.length === 0 && focusedDeploymentUuid && (
                                        <section class="grid min-w-0 gap-3 overflow-hidden rounded-2xl border border-base-300/70 bg-base-100 p-4 shadow-sm sm:p-5">
                                            <div class="flex min-w-0 flex-wrap items-center justify-between gap-3">
                                                <div class="min-w-0">
                                                    <p class="text-sm font-semibold">Suivi du déploiement</p>
                                                    <p class="text-xs text-base-content/50">
                                                        Logs et agent liés à cette tentative
                                                    </p>
                                                </div>
                                                {selectedDeployment && (
                                                    <DeploymentStatusIcon status={selectedDeployment.status} showLabel />
                                                )}
                                            </div>
                                            <DeploymentMonitorPanel
                                                deploymentUuid={focusedDeploymentUuid}
                                                deployment={selectedDeployment}
                                                onSelectDeployment={(deploymentUuid) => {
                                                    focusDeployment(deploymentUuid, true);
                                                    void deploymentsQuery.reload({ silent: true });
                                                }}
                                            />
                                        </section>
                                    )}

                                    {(attemptBuckets.failed.length > 0 || attemptBuckets.history.length > 0) && (
                                        <section class="min-w-0 overflow-hidden rounded-2xl border border-base-300/70 bg-base-100 shadow-sm">
                                            <div class="toolbar-row border-b border-base-300/70 px-4 py-4 sm:px-5">
                                                <div class="min-w-0">
                                                    <p class="text-sm font-semibold">Historique</p>
                                                    <p class="text-xs text-base-content/50">
                                                        Échecs précédents et déploiements terminés
                                                    </p>
                                                </div>
                                                <Server class="size-4 shrink-0 text-base-content/35" aria-hidden />
                                            </div>

                                            <div class="grid min-w-0 gap-4 p-4 sm:p-5">
                                                {attemptBuckets.failed.length > 0 && (
                                                    <DeploymentAttemptGroup
                                                        title="Échecs précédents"
                                                        hint="Tentatives en échec (hors sélection)"
                                                        tone="failed"
                                                        deployments={attemptBuckets.failed}
                                                        focusedUuid={focusedDeploymentUuid}
                                                        onSelect={(deploymentUuid) => focusDeployment(deploymentUuid, true)}
                                                        collapsible
                                                        defaultCollapsed={shouldCollapsePreviousFailures(attemptBuckets.failed.length)}
                                                    />
                                                )}
                                                {attemptBuckets.history.length > 0 && (
                                                    <DeploymentAttemptGroup
                                                        title="Terminés"
                                                        hint="Déploiements réussis ou annulés"
                                                        tone="history"
                                                        deployments={attemptBuckets.history}
                                                        focusedUuid={focusedDeploymentUuid}
                                                        onSelect={(deploymentUuid) => focusDeployment(deploymentUuid, true)}
                                                        collapsible
                                                        defaultCollapsed={attemptBuckets.history.length > 2}
                                                    />
                                                )}
                                            </div>
                                        </section>
                                    )}
                                </div>
                            </DataState>
                        </>
                    )}

                    {activeTab === 'settings' && (
                        <ApplicationRuntimeSettingsPanel
                            applicationUuid={resource.uuid}
                            canAct={canAct}
                            onChanged={reload}
                            onRedeployQueued={(deploymentUuid) => {
                                focusDeployment(deploymentUuid, false);
                                openDeploymentsTab();
                            }}
                        />
                    )}

                    {activeTab === 'domains' && (
                        <ApplicationDomainsPanel
                            applicationUuid={resource.uuid}
                            canAct={canAct}
                            onChanged={reload}
                        />
                    )}

                    {activeTab === 'databases' && (
                        <ConnectDatabasePanel
                            applicationUuid={resource.uuid}
                            canAct={canAct}
                            onConnected={reload}
                        />
                    )}

                    {activeTab === 'logs' && (
                        <ApplicationLogsPanel applicationUuid={resource.uuid} />
                    )}

                    {activeTab === 'variables' && (
                        <ApplicationEnvironmentVariablesPanel
                            applicationUuid={resource.uuid}
                            canAct={canAct}
                        />
                    )}

                    {activeTab === 'files' && (
                        <ApplicationSourceExplorer applicationUuid={resource.uuid} />
                    )}

                    {activeTab === 'danger' && (
                        <ApplicationDangerPanel
                            applicationUuid={resource.uuid}
                            applicationName={resource.name}
                            canAct={canAct}
                            onDeleted={async () => {
                                await onChanged();
                                onClose();
                            }}
                            onDatabaseReset={(deploymentUuid) => {
                                if (deploymentUuid) {
                                    focusDeployment(deploymentUuid, false);
                                    openDeploymentsTab();
                                }
                                void reload();
                                void onChanged();
                            }}
                        />
                    )}

                    {actionError && <p class="text-sm text-error" role="alert">{actionError}</p>}

                    {pendingAction && (
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
                </div>
            )}
        </DataState>
    );
}
