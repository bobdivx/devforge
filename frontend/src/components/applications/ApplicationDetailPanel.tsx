import {
    ArrowLeft,
    Ban,
    Bot,
    Check,
    ChevronDown,
    CircleAlert,
    ExternalLink,
    FileText,
    GitBranch,
    Globe,
    Loader2,
    Pencil,
    Play,
    RefreshCw,
    Rocket,
    RotateCw,
    Server,
    Sparkles,
    Square,
    Store,
    X,
    XCircle,
} from 'lucide-preact';
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { ActionToolbar } from '../ui/ActionToolbar';
import { Card } from '../ui/Card';
import { DataState } from '../ui/DataState';
import { DeploymentStatusIcon } from '../ui/DeploymentStatusIcon';
import { ResourceStatusIcon } from '../ui/ResourceStatusIcon';
import { Tabs } from '../ui/Tabs';
import { ApplicationAgentChatCard } from './ApplicationAgentChatCard';
import { ApplicationDomainsPanel } from './ApplicationDomainsPanel';
import { ApplicationDangerPanel } from './ApplicationDangerPanel';
import { ApplicationReadinessCard } from './ApplicationReadinessCard';
import { ApplicationRuntimeSettingsPanel } from './ApplicationRuntimeSettingsPanel';
import { ApplicationAccessPanel } from './ApplicationAccessPanel';
import { ApplicationAdvancedSettingsPanel } from './ApplicationAdvancedSettingsPanel';
import { ApplicationResourceOperationsPanel } from './ApplicationResourceOperationsPanel';
import { ApplicationEnvironmentVariablesPanel } from './ApplicationEnvironmentVariablesPanel';
import { ApplicationStatusBadges } from './ApplicationStatusBadges';
import { ConnectDatabasePanel } from './ConnectDatabasePanel';
import { ApplicationLogsPanel } from './ApplicationLogsPanel';
import { ApplicationWebhooksPanel } from './ApplicationWebhooksPanel';
import { ApplicationPreviewsPanel } from './ApplicationPreviewsPanel';
import { ApplicationResourceLimitsPanel } from './ApplicationResourceLimitsPanel';
import { ApplicationScheduledTasksPanel } from './ApplicationScheduledTasksPanel';
import { ApplicationStoragePanel } from './ApplicationStoragePanel';
import { DeploymentAgentCard } from './DeploymentAgentCard';
import { DeploymentMonitorPanel } from './DeploymentMonitorPanel';
import { ApplicationSourceExplorer } from './ApplicationSourceExplorer';
import { ApplicationFeatureRequestModal } from './ApplicationFeatureRequestModal';
import { PublishToStoreModal } from './PublishToStoreModal';
import {
    deploymentSystemLabel,
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
import { applicationTabGroups, parseApplicationTab, type ApplicationTabId } from '../../lib/application-tabs';
import { canVisitApplication, isResourceRunning, resolveCoreResourceActions, resourceStatusPrimary } from '../../lib/core-resource-actions';
import { domainApi, type ApplicationReadiness, type CoreAction, type GithubBranch } from '../../lib/domain-api';
import { isDeploymentActive, isDeploymentCancellable } from '../../lib/deployment-status';
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

function gitSyncLabel(upToDate: boolean | null, available: boolean): { text: string; tone: 'success' | 'warning' | 'neutral' } {
    if (!available) {
        return { text: 'Sync Git indisponible', tone: 'neutral' };
    }
    if (upToDate === true) {
        return { text: 'À jour avec GitHub', tone: 'success' };
    }
    if (upToDate === false) {
        return { text: 'Nouvelle version sur GitHub', tone: 'warning' };
    }
    return { text: 'Statut Git inconnu', tone: 'neutral' };
}

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
    canCancel = false,
    cancellingUuid = null,
    onCancel,
    collapsible = false,
    defaultCollapsed = false,
    showAgentButton = false,
}: {
    title: string;
    hint: string;
    tone: AttemptTone;
    deployments: Deployment[];
    focusedUuid: string | null;
    onSelect: (uuid: string) => void;
    canCancel?: boolean;
    cancellingUuid?: string | null;
    onCancel?: (uuid: string) => void;
    collapsible?: boolean;
    defaultCollapsed?: boolean;
    showAgentButton?: boolean;
}) {
    const [open, setOpen] = useState(!defaultCollapsed);
    const [agentOpenUuid, setAgentOpenUuid] = useState<string | null>(null);
    const toneClass = {
        current: 'border-primary/35 bg-primary/5',
        active: 'border-warning/30 bg-warning/5',
        failed: 'border-error/25 bg-error/5',
        history: 'border-base-300/70 bg-base-200/30',
    }[tone];

    const header = (
        <div class="flex min-w-0 items-start justify-between gap-2">
            <div class="min-w-0">
                <p class="flex flex-wrap items-center gap-2 text-xs sm:text-sm font-semibold">
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
                        const showCancel = canCancel
                            && onCancel
                            && isDeploymentCancellable(deployment.status);
                        const agentExpanded = showAgentButton && agentOpenUuid === deployment.uuid;

                        return (
                            <li key={deployment.uuid} class="min-w-0">
                                <div
                                    class={`flex w-full min-w-0 flex-col gap-2 rounded-lg border px-3 py-2 transition sm:flex-row sm:items-center sm:justify-between ${
                                        selected
                                            ? 'border-primary/40 bg-base-100'
                                            : 'border-base-300/60 bg-base-100/80 hover:border-primary/30'
                                    }`}
                                >
                                    <button
                                        class="flex min-w-0 flex-1 flex-col gap-1 overflow-hidden text-left"
                                        type="button"
                                        onClick={() => onSelect(deployment.uuid)}
                                    >
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
                                    </button>
                                    <span class="flex shrink-0 flex-wrap items-center gap-1">
                                        {showCancel && (
                                            <button
                                                class="btn btn-ghost btn-xs text-error"
                                                type="button"
                                                disabled={cancellingUuid === deployment.uuid}
                                                aria-label="Annuler le déploiement"
                                                onClick={() => onCancel(deployment.uuid)}
                                            >
                                                {cancellingUuid === deployment.uuid
                                                    ? <Loader2 class="size-3.5 animate-spin" aria-hidden />
                                                    : <Ban class="size-3.5" aria-hidden />}
                                                Annuler
                                            </button>
                                        )}
                                        {showAgentButton && (
                                            <button
                                                class={`btn btn-ghost btn-xs ${agentExpanded ? 'text-primary' : ''}`}
                                                type="button"
                                                aria-expanded={agentExpanded}
                                                aria-label={agentExpanded ? 'Masquer l’agent' : 'Ouvrir l’agent'}
                                                onClick={() => setAgentOpenUuid((current) => (
                                                    current === deployment.uuid ? null : deployment.uuid
                                                ))}
                                            >
                                                <Bot class="size-3.5" aria-hidden />
                                                Agent
                                            </button>
                                        )}
                                        <button
                                            class={`btn btn-ghost btn-xs ${selected ? 'text-primary' : ''}`}
                                            type="button"
                                            onClick={() => onSelect(deployment.uuid)}
                                        >
                                            <FileText class="size-3.5" aria-hidden />
                                            {selected ? 'Actif' : 'Logs'}
                                        </button>
                                    </span>
                                </div>
                                {agentExpanded && (
                                    <div class="mt-2 min-w-0">
                                        <DeploymentAgentCard
                                            deploymentUuid={deployment.uuid}
                                            historyMode
                                            pollWhileActive={false}
                                            onSelectDeployment={onSelect}
                                        />
                                    </div>
                                )}
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
        <div class="relative overflow-hidden rounded-[1.25rem] bg-base-200/70">
            {showPlaceholder ? (
                <div class="aspect-[4/3] flex flex-col items-center justify-center gap-2 sm:gap-3 p-6 text-center">
                    <div class="grid size-16 place-items-center rounded-2xl bg-base-100 text-xl font-bold shadow-sm">
                        {initials || 'A'}
                    </div>
                    <div>
                        <p class="text-xs sm:text-sm font-semibold">{name}</p>
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
                        <p class="text-xs sm:text-sm font-semibold text-base-content">{name}</p>
                        <p class="truncate text-xs text-base-content/70">{domain}</p>
                    </div>
                </div>
            )}
            {href && (
                <a
                    class="absolute inset-x-0 bottom-0 flex items-center justify-center gap-2 border-t border-base-300/70 bg-base-100/90 px-2.5 sm:px-3 md:px-4 py-2.5 sm:py-3 text-xs sm:text-sm font-medium text-primary transition hover:bg-base-100"
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
    initialTab?: ApplicationTabId;
    onClose: () => void;
    onChanged: () => Promise<void>;
    onTabChange?: (tab: ApplicationTabId) => void;
};

export function ApplicationDetailPanel({
    uuid,
    canAct,
    initialTab = 'overview',
    onClose,
    onChanged,
    onTabChange,
}: ApplicationDetailPanelProps) {
    const resourceQuery = useApiQuery(`core:applications:${uuid}`, () => domainApi.coreResource('applications', uuid));
    const deploymentsQuery = useApiQuery(`deployments:${uuid}`, () => domainApi.deployments(1, uuid, 8));
    const readinessQuery = useApiQuery(`readiness:${uuid}`, () => domainApi.applicationReadiness(uuid));
    const gitSyncQuery = useApiQuery(`git-sync:${uuid}`, () => domainApi.applicationGitSync(uuid));
    const [activeTab, setActiveTab] = useState<ApplicationTabId>(initialTab);
    const [acting, setActing] = useState<CoreAction | null>(null);
    const [pendingAction, setPendingAction] = useState<CoreAction | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);
    const [focusedDeploymentUuid, setFocusedDeploymentUuid] = useState<string | null>(null);
    const [focusPinned, setFocusPinned] = useState(false);
    const [pendingCancelUuid, setPendingCancelUuid] = useState<string | null>(null);
    const [cancellingUuid, setCancellingUuid] = useState<string | null>(null);
    const [cancelError, setCancelError] = useState<string | null>(null);
    const [editingName, setEditingName] = useState(false);
    const [nameDraft, setNameDraft] = useState('');
    const [renaming, setRenaming] = useState(false);
    const [renameError, setRenameError] = useState<string | null>(null);
    const [featureRequestOpen, setFeatureRequestOpen] = useState(false);
    const [publishStoreOpen, setPublishStoreOpen] = useState(false);
    const [deployBranch, setDeployBranch] = useState<string>('');
    const [deployBranches, setDeployBranches] = useState<GithubBranch[]>([]);
    const [deployBranchesLoading, setDeployBranchesLoading] = useState(false);
    const [deployBranchesError, setDeployBranchesError] = useState<string | null>(null);

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
    const gitSync = gitSyncQuery.data?.data ?? null;
    const syncBadge = gitSync
        ? gitSyncLabel(gitSync.up_to_date, gitSync.available)
        : null;

    const focusDeployment = (deploymentUuid: string, pinned = false) => {
        setFocusedDeploymentUuid(deploymentUuid);
        setFocusPinned(pinned);
    };

    useEffect(() => {
        setFocusedDeploymentUuid(null);
        setFocusPinned(false);
        setActiveTab(initialTab);
        setActing(null);
        setPendingAction(null);
        setActionError(null);
        setPendingCancelUuid(null);
        setCancellingUuid(null);
        setCancelError(null);
        setDeployBranch('');
        setDeployBranches([]);
        setDeployBranchesError(null);
    }, [uuid, initialTab]);

    useEffect(() => {
        if (pendingAction !== 'deploy' || !resource) {
            return;
        }

        let cancelled = false;
        setDeployBranchesLoading(true);
        setDeployBranchesError(null);
        setDeployBranch(config?.git_branch ?? '');

        void (async () => {
            try {
                const source = await domainApi.applicationSourceInfo(resource.uuid);
                const info = source.data;
                if (cancelled) {
                    return;
                }

                const currentBranch = info.git_branch ?? config?.git_branch ?? '';
                setDeployBranch(currentBranch);

                if (!info.available || !info.github_app_uuid || !info.owner || !info.repo) {
                    setDeployBranches(currentBranch ? [{ name: currentBranch, protected: false }] : []);
                    return;
                }

                const branchesResponse = await domainApi.githubBranches(info.github_app_uuid, info.owner, info.repo);
                if (cancelled) {
                    return;
                }

                const branches = branchesResponse.data ?? [];
                if (currentBranch && !branches.some((branch) => branch.name === currentBranch)) {
                    setDeployBranches([{ name: currentBranch, protected: false }, ...branches]);
                } else {
                    setDeployBranches(branches);
                }
            } catch {
                if (!cancelled) {
                    setDeployBranchesError('Impossible de charger les branches GitHub.');
                    const fallback = config?.git_branch ?? '';
                    setDeployBranches(fallback ? [{ name: fallback, protected: false }] : []);
                }
            } finally {
                if (!cancelled) {
                    setDeployBranchesLoading(false);
                }
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [pendingAction, resource?.uuid, config?.git_branch]);

    useEffect(() => {
        const syncTabFromUrl = () => {
            setActiveTab(parseApplicationTab(new URLSearchParams(window.location.search).get('tab')));
        };

        window.addEventListener('popstate', syncTabFromUrl);

        return () => window.removeEventListener('popstate', syncTabFromUrl);
    }, []);

    const selectTab = (tab: ApplicationTabId) => {
        setActiveTab(tab);
        onTabChange?.(tab);
    };

    useEffect(() => {
        setFocusedDeploymentUuid((current) => pickFocusedDeployment(deployments, current, { pinned: focusPinned }));
    }, [deployments, focusPinned]);

    const hadActiveDeploymentRef = useRef(false);

    useEffect(() => {
        const primary = resourceStatusPrimary(status);
        const transitioning = primary === 'restarting' || primary === 'starting' || primary === 'created';

        if (!hasActiveDeployment && !transitioning) {
            return;
        }

        const refreshStatus = () => {
            void deploymentsQuery.reload({ silent: true });
            void resourceQuery.reload({ silent: true });
            void readinessQuery.reload({ silent: true });
            void gitSyncQuery.reload({ silent: true });
        };

        refreshStatus();
        const interval = window.setInterval(refreshStatus, 3000);

        return () => window.clearInterval(interval);
    }, [hasActiveDeployment, status, uuid, deploymentsQuery.reload, resourceQuery.reload, readinessQuery.reload, gitSyncQuery.reload]);

    useEffect(() => {
        if (hadActiveDeploymentRef.current && !hasActiveDeployment) {
            void deploymentsQuery.reload({ silent: true });
            void resourceQuery.reload({ silent: true });
            void readinessQuery.reload({ silent: true });
            void gitSyncQuery.reload({ silent: true });
        }

        hadActiveDeploymentRef.current = hasActiveDeployment;
    }, [hasActiveDeployment, deploymentsQuery.reload, resourceQuery.reload, readinessQuery.reload, gitSyncQuery.reload]);

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
        selectTab('deployments');
    };

    const reload = async () => {
        await Promise.all([
            resourceQuery.reload(),
            deploymentsQuery.reload(),
            readinessQuery.reload(),
            gitSyncQuery.reload(),
        ]);
    };

    const runAction = async (action: CoreAction, payload?: { force?: boolean }) => {
        if (!resource) {
            return;
        }

        setActing(action);
        setActionError(null);
        try {
            if (action === 'deploy' && deployBranch.trim() !== '' && deployBranch !== (config?.git_branch ?? '')) {
                await domainApi.updateApplicationGitBranch(resource.uuid, deployBranch.trim());
            }

            const response = await domainApi.coreAction('applications', resource.uuid, action, payload);
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

    const confirmCancelDeployment = async () => {
        if (!pendingCancelUuid || !canAct) {
            return;
        }

        const uuidToCancel = pendingCancelUuid;
        setCancellingUuid(uuidToCancel);
        setCancelError(null);

        try {
            await domainApi.cancelDeployment(uuidToCancel);
            setPendingCancelUuid(null);
            await deploymentsQuery.reload();
        } catch {
            setCancelError('Impossible d’annuler ce déploiement.');
        } finally {
            setCancellingUuid(null);
        }
    };

    const startRename = () => {
        if (!resource || !canAct) {
            return;
        }
        setNameDraft(resource.name);
        setRenameError(null);
        setEditingName(true);
    };

    const cancelRename = () => {
        setEditingName(false);
        setRenameError(null);
        setNameDraft('');
    };

    const saveRename = async () => {
        if (!resource) {
            return;
        }

        const nextName = nameDraft.trim();
        if (nextName.length < 3) {
            setRenameError('Le nom doit contenir au moins 3 caractères.');
            return;
        }
        if (nextName === resource.name) {
            cancelRename();
            return;
        }

        setRenaming(true);
        setRenameError(null);
        try {
            await domainApi.updateApplication(resource.uuid, { name: nextName });
            setEditingName(false);
            await reload();
            await onChanged();
        } catch {
            setRenameError('Impossible de renommer l’application.');
        } finally {
            setRenaming(false);
        }
    };

    const onRenameKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            void saveRename();
        }
        if (event.key === 'Escape') {
            event.preventDefault();
            cancelRename();
        }
    };

    return (
        <DataState loading={resourceQuery.loading} error={resourceQuery.error} onRetry={() => void reload()}>
            {resource && config && (
                <div class="grid min-w-0 max-w-full gap-3 sm:gap-4 md:gap-5 overflow-x-hidden">
                    <div class="grid min-w-0 gap-2.5 sm:gap-3 md:gap-4 sm:flex sm:flex-row sm:items-start sm:justify-between">
                        <div class="grid min-w-0 gap-2">
                            <button class="btn btn-ghost btn-sm -ms-2 w-fit px-3" type="button" onClick={onClose}>
                                <ArrowLeft class="size-4" aria-hidden />
                                Applications
                            </button>
                            <div class="min-w-0">
                                {editingName ? (
                                    <div class="grid min-w-0 gap-2">
                                        <div class="flex min-w-0 flex-wrap items-center gap-2">
                                            <input
                                                aria-label="Nom de l’application"
                                                autoFocus
                                                class="input input-bordered input-sm min-w-0 flex-1 text-sm sm:text-base font-semibold sm:text-lg"
                                                disabled={renaming}
                                                maxLength={255}
                                                type="text"
                                                value={nameDraft}
                                                onInput={(event) => setNameDraft((event.target as HTMLInputElement).value)}
                                                onKeyDown={onRenameKeyDown}
                                            />
                                            <button
                                                aria-label="Enregistrer le nom"
                                                class="btn btn-primary btn-sm btn-square rounded-full"
                                                disabled={renaming}
                                                type="button"
                                                onClick={() => void saveRename()}
                                            >
                                                {renaming ? <Loader2 class="size-3.5 animate-spin" aria-hidden /> : <Check class="size-3.5" aria-hidden />}
                                            </button>
                                            <button
                                                aria-label="Annuler le renommage"
                                                class="btn btn-ghost btn-sm btn-square rounded-full border border-base-300/80"
                                                disabled={renaming}
                                                type="button"
                                                onClick={cancelRename}
                                            >
                                                <X class="size-3.5" aria-hidden />
                                            </button>
                                        </div>
                                        {renameError && <p class="text-sm text-error">{renameError}</p>}
                                    </div>
                                ) : (
                                    <div class="flex min-w-0 items-start gap-2">
                                        <h2 class="min-w-0 flex-1 break-words text-[1.75rem] font-semibold tracking-tight sm:text-3xl">
                                            {canAct ? (
                                                <button
                                                    class="max-w-full rounded-md text-start transition hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                                                    type="button"
                                                    title="Modifier le nom"
                                                    onClick={startRename}
                                                >
                                                    {resource.name}
                                                </button>
                                            ) : (
                                                resource.name
                                            )}
                                        </h2>
                                        {canAct && (
                                            <button
                                                aria-label="Modifier le nom"
                                                class="btn btn-sm btn-square shrink-0 rounded-full border border-base-content/45 bg-base-100 text-base-content shadow-sm hover:border-primary hover:bg-primary/15 hover:text-primary"
                                                type="button"
                                                title="Modifier le nom"
                                                onClick={startRename}
                                            >
                                                <Pencil class="size-3.5 sm:size-4 stroke-[2.25]" aria-hidden />
                                            </button>
                                        )}
                                    </div>
                                )}
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
                                        pollDatabases={hasActiveDeployment}
                                        onOpenTab={(tab) => {
                                            if (tab === 'deployments') {
                                                openDeploymentsTab();
                                                return;
                                            }
                                            selectTab(tab);
                                        }}
                                    />
                                </div>
                            </div>
                        </div>
                        <ActionToolbar class="w-full min-w-0">
                            {visit && (
                                <a
                                    class="btn btn-primary btn-sm"
                                    href={visit}
                                    rel="noreferrer"
                                    target="_blank"
                                    aria-label="Visiter"
                                    title="Visiter"
                                >
                                    <ExternalLink class="size-3.5" aria-hidden />
                                    <span class="action-toolbar-label">Visiter</span>
                                </a>
                            )}
                            {canAct && (
                                <button
                                    class="btn btn-ghost btn-sm border border-base-300/80"
                                    type="button"
                                    aria-label="Nouvelle fonctionnalité"
                                    title="Nouvelle fonctionnalité"
                                    onClick={() => setFeatureRequestOpen(true)}
                                >
                                    <Sparkles class="size-3.5" aria-hidden />
                                    <span class="action-toolbar-label">Nouvelle fonctionnalité</span>
                                </button>
                            )}
                            {canAct && isResourceRunning(status) && (
                                <button
                                    class="btn btn-ghost btn-sm border border-base-300/80"
                                    type="button"
                                    aria-label="Publier sur le Store"
                                    title="Publier sur le Store"
                                    onClick={() => setPublishStoreOpen(true)}
                                >
                                    <Store class="size-3.5" aria-hidden />
                                    <span class="action-toolbar-label">Publier</span>
                                </button>
                            )}
                            {canAct && availableActions.map((action) => {
                                const Icon = actionIcons[action];
                                const primary = action === 'deploy';
                                const label = acting === action ? 'En cours…' : actionLabels[action];

                                return (
                                    <button
                                        class={`btn btn-sm ${primary ? 'btn-primary' : 'btn-ghost border border-base-300/80'}`}
                                        type="button"
                                        disabled={acting !== null}
                                        key={action}
                                        aria-label={label}
                                        title={label}
                                        onClick={() => {
                                            if (['stop', 'restart', 'deploy'].includes(action)) {
                                                setPendingAction(action);
                                                return;
                                            }
                                            void runAction(action);
                                        }}
                                    >
                                        <Icon class="size-3.5" aria-hidden />
                                        <span class="action-toolbar-label">{label}</span>
                                    </button>
                                );
                            })}
                            <button
                                class="btn btn-ghost btn-sm border border-base-300/80"
                                type="button"
                                aria-label="Actualiser"
                                title="Actualiser"
                                onClick={() => void reload()}
                            >
                                <RefreshCw class="size-3.5" aria-hidden />
                                <span class="action-toolbar-label">Actualiser</span>
                            </button>
                        </ActionToolbar>
                    </div>

                    <div class="flex flex-col lg:flex-row gap-2.5 sm:gap-3 md:gap-4 lg:gap-6 mt-4">
                        <div class="lg:w-56 shrink-0">
                            <Tabs
                                groups={applicationTabGroups}
                                active={activeTab}
                                variant="sidebar"
                                onChange={(tabId) => {
                                    const next = tabId as ApplicationTabId;
                                    if (next === 'deployments') {
                                        openDeploymentsTab();
                                        return;
                                    }
                                    selectTab(next);
                                }}
                            />
                        </div>
                        <div class="min-w-0 flex-1 grid gap-4">
                    {activeTab === 'overview' && (
                        <>
                            <Card
                                title="Production"
                                eyebrow="Aperçu"
                                class="min-w-0"
                            >
                                <p class="text-xs text-base-content/50">
                                    Aperçu, domaines et source
                                    {gitSync?.deployed_at || latest
                                        ? ` · dernier déploiement ${relativeUpdatedAt(gitSync?.deployed_at ?? latest?.finished_at ?? latest?.created_at ?? null)}`
                                        : ''}
                                    {syncBadge && gitSync?.available
                                        ? ` · ${syncBadge.text}`
                                        : ''}
                                </p>

                                <div class="grid min-w-0 gap-3 sm:gap-4 md:gap-5 lg:grid-cols-[minmax(0,280px)_1fr]">
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
                                            <div class="grid gap-1.5">
                                                <span class="inline-flex min-w-0 flex-wrap items-center gap-2">
                                                    <GitBranch class="size-3.5 shrink-0 text-base-content/45" aria-hidden />
                                                    <span class="font-medium">{gitSync?.git_branch ?? config.git_branch ?? 'branche inconnue'}</span>
                                                    {config.git_repository && (
                                                        <span class="truncate text-xs text-base-content/50">
                                                            {repositoryLabel(config.git_repository)}
                                                        </span>
                                                    )}
                                                </span>
                                                {(gitSync?.deployed_at || latest) && (
                                                    <span class="text-xs text-base-content/55">
                                                        Dernier déploiement
                                                        {' '}
                                                        {relativeUpdatedAt(gitSync?.deployed_at ?? latest?.finished_at ?? latest?.created_at ?? null)}
                                                        {(gitSync?.deployed_at || latest?.finished_at || latest?.created_at)
                                                            ? ` · ${formatDateTime(gitSync?.deployed_at ?? latest?.finished_at ?? latest?.created_at ?? null)}`
                                                            : ''}
                                                    </span>
                                                )}
                                                {(gitSync?.deployed_commit || latest?.commit) && (
                                                    <span class="break-words font-mono text-xs text-base-content/55">
                                                        {shortCommit(gitSync?.deployed_commit ?? latest?.commit ?? null)}
                                                        {(gitSync?.deployed_commit_message || latest?.commit_message)
                                                            ? ` · ${gitSync?.deployed_commit_message ?? latest?.commit_message}`
                                                            : ''}
                                                    </span>
                                                )}
                                                {syncBadge && (
                                                    <span
                                                        class={`inline-flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                                                            syncBadge.tone === 'success'
                                                                ? 'border-success/30 bg-success/10 text-success'
                                                                : syncBadge.tone === 'warning'
                                                                    ? 'border-warning/30 bg-warning/10 text-warning'
                                                                    : 'border-base-300/80 bg-base-200/70 text-base-content/55'
                                                        }`}
                                                        title={gitSync?.remote_error ?? undefined}
                                                    >
                                                        {syncBadge.tone === 'success' ? (
                                                            <Check class="size-3.5" aria-hidden />
                                                        ) : syncBadge.tone === 'warning' ? (
                                                            <CircleAlert class="size-3.5" aria-hidden />
                                                        ) : (
                                                            <GitBranch class="size-3.5" aria-hidden />
                                                        )}
                                                        {gitSyncQuery.loading && !gitSync ? 'Vérification GitHub…' : syncBadge.text}
                                                        {gitSync?.remote_head_sha && gitSync.up_to_date === false && (
                                                            <span class="font-mono font-normal opacity-80">
                                                                {shortCommit(gitSync.remote_head_sha)}
                                                            </span>
                                                        )}
                                                    </span>
                                                )}
                                            </div>
                                        </DetailRow>
                                        <DetailRow label="Système">
                                            <span>{deploymentSystemLabel(config)}</span>
                                        </DetailRow>
                                        <DetailRow label="Build">
                                            <span>
                                                {config.build_pack ?? '—'}
                                                {config.is_static ? ' · statique' : ''}
                                                {config.ports_exposes ? ` · port ${config.ports_exposes}` : ''}
                                            </span>
                                        </DetailRow>
                                        <DetailRow label="Sortie">
                                            <span class="font-mono text-xs">
                                                {config.publish_directory || '—'}
                                            </span>
                                        </DetailRow>
                                        <DetailRow label="Base">
                                            <span class="font-mono text-xs">
                                                {config.base_directory || '—'}
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
                            </Card>

                            <div class="flex flex-wrap gap-2">
                                <button
                                    class="btn btn-ghost btn-sm border border-base-300/80"
                                    type="button"
                                    onClick={() => setActiveTab('settings')}
                                >
                                    Paramètres runtime
                                </button>
                                <button
                                    class="btn btn-ghost btn-sm border border-base-300/80"
                                    type="button"
                                    onClick={openDeploymentsTab}
                                >
                                    <Rocket class="size-3.5" aria-hidden />
                                    Voir les déploiements
                                </button>
                                {config.server?.uuid && (
                                    <button
                                        class="btn btn-ghost btn-sm border border-base-300/80"
                                        type="button"
                                        onClick={() => setActiveTab('files')}
                                    >
                                        <FileText class="size-3.5" aria-hidden />
                                        Code source
                                    </button>
                                )}
                            </div>

                            <ApplicationAgentChatCard application={resource} />

                            {resource.description && (
                                <section class="devforge-card p-5 text-sm text-base-content/65">
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
                                            <div class="border-b border-base-300/70 px-3 sm:px-2.5 sm:px-3 md:px-4 py-2.5 sm:py-3 sm:py-4 sm:px-5">
                                                <div class="min-w-0">
                                                    <p class="text-xs sm:text-sm font-semibold">
                                                        {hasActiveDeployment ? 'Déploiement en cours' : 'Déploiement suivi'}
                                                    </p>
                                                    <p class="text-xs text-base-content/50">
                                                        Logs et agent pour la tentative sélectionnée
                                                    </p>
                                                </div>
                                            </div>

                                            <div class="grid min-w-0 gap-2.5 sm:gap-3 md:gap-4 p-4 sm:p-5">
                                                {attemptBuckets.current && (
                                                    <DeploymentAttemptGroup
                                                        title="Sélection"
                                                        hint="Cette tentative alimente les logs ci-dessous"
                                                        tone="current"
                                                        deployments={[attemptBuckets.current]}
                                                        focusedUuid={focusedDeploymentUuid}
                                                        onSelect={(deploymentUuid) => focusDeployment(deploymentUuid, true)}
                                                        canCancel={canAct}
                                                        cancellingUuid={cancellingUuid}
                                                        onCancel={(deploymentUuid) => {
                                                            setCancelError(null);
                                                            setPendingCancelUuid(deploymentUuid);
                                                        }}
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
                                                        canCancel={canAct}
                                                        cancellingUuid={cancellingUuid}
                                                        onCancel={(deploymentUuid) => {
                                                            setCancelError(null);
                                                            setPendingCancelUuid(deploymentUuid);
                                                        }}
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
                                        <section class="grid min-w-0 gap-2 sm:gap-3 overflow-hidden rounded-2xl border border-base-300/70 bg-base-100 p-4 shadow-sm sm:p-5">
                                            <div class="min-w-0">
                                                <p class="text-xs sm:text-sm font-semibold">Suivi du déploiement</p>
                                                <p class="text-xs text-base-content/50">
                                                    Logs et agent liés à cette tentative
                                                </p>
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
                                            <div class="toolbar-row border-b border-base-300/70 px-3 sm:px-2.5 sm:px-3 md:px-4 py-2.5 sm:py-3 sm:py-4 sm:px-5">
                                                <div class="min-w-0">
                                                    <p class="text-xs sm:text-sm font-semibold">Historique</p>
                                                    <p class="text-xs text-base-content/50">
                                                        Échecs précédents et déploiements terminés
                                                    </p>
                                                </div>
                                                <Server class="size-3.5 sm:size-4 shrink-0 text-base-content/35" aria-hidden />
                                            </div>

                                            <div class="grid min-w-0 gap-2.5 sm:gap-3 md:gap-4 p-4 sm:p-5">
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
                                                        showAgentButton
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
                                                        showAgentButton
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
                        <div class="grid gap-4">
                            <ApplicationAccessPanel
                                applicationUuid={resource.uuid}
                                canAct={canAct}
                                onChanged={reload}
                                onRedeployQueued={(deploymentUuid) => {
                                    focusDeployment(deploymentUuid, false);
                                    openDeploymentsTab();
                                }}
                            />
                            <ApplicationRuntimeSettingsPanel
                                applicationUuid={resource.uuid}
                                canAct={canAct}
                                onChanged={reload}
                                onRedeployQueued={(deploymentUuid) => {
                                    focusDeployment(deploymentUuid, false);
                                    openDeploymentsTab();
                                }}
                            />
                            <ApplicationAdvancedSettingsPanel
                                applicationUuid={resource.uuid}
                                canAct={canAct}
                            />
                            <ApplicationResourceOperationsPanel
                                applicationUuid={resource.uuid}
                                canAct={canAct}
                            />
                        </div>
                    )}

                    {activeTab === 'domains' && (
                        <div class="grid gap-5">
                            <ApplicationReadinessCard applicationUuid={uuid} canAct={canAct} />
                            <ApplicationDomainsPanel
                                applicationUuid={resource.uuid}
                                canAct={canAct}
                                onChanged={reload}
                                onRedeployQueued={(deploymentUuid) => {
                                    focusDeployment(deploymentUuid, false);
                                    openDeploymentsTab();
                                }}
                            />
                        </div>
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

                    {activeTab === 'webhooks' && (
                        <ApplicationWebhooksPanel
                            applicationUuid={resource.uuid}
                            canAct={canAct}
                        />
                    )}

                    {activeTab === 'previews' && (
                        <ApplicationPreviewsPanel
                            applicationUuid={resource.uuid}
                            canAct={canAct}
                        />
                    )}

                    {activeTab === 'storage' && (
                        <ApplicationStoragePanel
                            resourceType="applications"
                            resourceUuid={resource.uuid}
                            canAct={canAct}
                        />
                    )}

                    {activeTab === 'limits' && (
                        <ApplicationResourceLimitsPanel
                            applicationUuid={resource.uuid}
                            canAct={canAct}
                        />
                    )}

                    {activeTab === 'tasks' && (
                        <ApplicationScheduledTasksPanel
                            resourceType="applications"
                            resourceUuid={resource.uuid}
                            canAct={canAct}
                        />
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

                        </div>
                    </div>

                    {actionError && <p class="text-sm text-error" role="alert">{actionError}</p>}
                    {cancelError && <p class="text-sm text-error" role="alert">{cancelError}</p>}

                    {pendingAction && (
                        <ConfirmDialog
                            open
                            title={actionLabels[pendingAction]}
                            message={pendingAction === 'deploy' ? (
                                <>
                                    <p>
                                        Déployer «
                                        {' '}
                                        <span class="font-medium text-base-content">{resource.name}</span>
                                        » ?
                                    </p>
                                    <label class="grid gap-1.5">
                                        <span class="text-xs font-medium uppercase tracking-wide text-base-content/45">
                                            Branche GitHub
                                        </span>
                                        <select
                                            class="select select-bordered w-full"
                                            value={deployBranch}
                                            disabled={deployBranchesLoading || acting === 'deploy'}
                                            onChange={(event) => setDeployBranch((event.target as HTMLSelectElement).value)}
                                        >
                                            {deployBranchesLoading && deployBranches.length === 0 && (
                                                <option value={deployBranch || config?.git_branch || ''}>
                                                    Chargement des branches…
                                                </option>
                                            )}
                                            {deployBranches.map((branch) => (
                                                <option key={branch.name} value={branch.name}>
                                                    {branch.name}
                                                    {branch.protected ? ' (protégée)' : ''}
                                                </option>
                                            ))}
                                            {!deployBranchesLoading && deployBranches.length === 0 && (
                                                <option value={deployBranch || config?.git_branch || ''}>
                                                    {deployBranch || config?.git_branch || 'Branche inconnue'}
                                                </option>
                                            )}
                                        </select>
                                        {deployBranchesError && (
                                            <span class="text-xs text-warning">{deployBranchesError}</span>
                                        )}
                                    </label>
                                    <ul class="list-disc space-y-1 pl-5 text-base-content/65">
                                        <li>
                                            <span class="font-medium text-base-content">Reconstruire l’image</span>
                                            {' '}
                                            — recommandé : nouvelle image + conteneur (variables d’env, dépendances, code).
                                        </li>
                                        <li>
                                            <span class="font-medium text-base-content">Déployer (cache)</span>
                                            {' '}
                                            — plus rapide : réutilise l’image existante si possible.
                                        </li>
                                    </ul>
                                </>
                            ) : pendingAction === 'restart' ? (
                                `Redémarrer « ${resource.name} » relance le conteneur en cours, sans reconstruire l’image ni lancer un déploiement.`
                            ) : `Confirmer « ${actionLabels[pendingAction]} » sur « ${resource.name} » ?`}
                            tone={pendingAction === 'stop' ? 'danger' : 'primary'}
                            loading={acting === pendingAction}
                            onCancel={() => setPendingAction(null)}
                            onConfirm={() => void runAction(
                                pendingAction,
                                pendingAction === 'deploy' ? { force: true } : undefined,
                            )}
                            confirmLabel={pendingAction === 'deploy' ? 'Reconstruire l’image' : 'Confirmer'}
                            secondaryConfirmLabel={pendingAction === 'deploy' ? 'Déployer (cache)' : undefined}
                            onSecondaryConfirm={pendingAction === 'deploy'
                                ? () => void runAction(pendingAction)
                                : undefined}
                        />
                    )}

                    {pendingCancelUuid && (
                        <ConfirmDialog
                            open
                            title="Annuler le déploiement"
                            message="Annuler cette tentative en file ou en cours ? Les déploiements suivants pourront démarrer."
                            tone="danger"
                            loading={cancellingUuid === pendingCancelUuid}
                            onCancel={() => setPendingCancelUuid(null)}
                            onConfirm={() => void confirmCancelDeployment()}
                            confirmLabel="Oui, annuler"
                            cancelLabel="Fermer"
                        />
                    )}

                    <ApplicationFeatureRequestModal
                        open={featureRequestOpen}
                        applicationUuid={resource.uuid}
                        applicationName={resource.name}
                        onClose={() => setFeatureRequestOpen(false)}
                    />
                    <PublishToStoreModal
                        open={publishStoreOpen}
                        applicationUuid={resource.uuid}
                        applicationName={resource.name}
                        onClose={() => setPublishStoreOpen(false)}
                        onPublished={() => undefined}
                    />
                </div>
            )}
        </DataState>
    );
}
