import {
    ArrowLeft,
    ExternalLink,
    FileText,
    GitBranch,
    Globe,
    Play,
    RefreshCw,
    Rocket,
    RotateCw,
    Server,
    Square,
} from 'lucide-preact';
import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { DataState } from '../ui/DataState';
import { DeploymentStatusIcon } from '../ui/DeploymentStatusIcon';
import { ResourceStatusIcon } from '../ui/ResourceStatusIcon';
import { Table } from '../ui/Table';
import { ConnectDatabasePanel } from './ConnectDatabasePanel';
import { ApplicationLogsPanel } from './ApplicationLogsPanel';
import { DeploymentMonitorPanel } from './DeploymentMonitorPanel';
import {
    formatDateTime,
    latestDeployment,
    parseApplicationConfiguration,
    primaryDomain,
    relativeUpdatedAt,
    repositoryLabel,
    shortCommit,
    visitUrl,
    websiteScreenshotUrl,
} from '../../lib/application-config';
import { domainApi, type CoreAction, type Deployment } from '../../lib/domain-api';
import { isDeploymentActive } from '../../lib/deployment-status';
import { useApiQuery } from '../../lib/use-api-query';

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

function MetricCard({ title, children }: { title: string; children: ComponentChildren }) {
    return (
        <section class="rounded-2xl border border-base-300/70 bg-base-100 p-4 shadow-sm">
            <h3 class="mb-3 text-sm font-semibold">{title}</h3>
            <div class="grid gap-2 text-sm">{children}</div>
        </section>
    );
}

function PreviewPanel({ name, domain, status }: { name: string; domain: string | null; status: string }) {
    const href = visitUrl(domain);
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
                    <ResourceStatusIcon status={status} showLabel />
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
                        }`}
                        decoding="async"
                        loading="lazy"
                        src={screenshotUrl}
                        onError={() => setScreenshotState('error')}
                        onLoad={() => setScreenshotState('loaded')}
                    />
                    <div class="pointer-events-none absolute inset-x-0 top-0 flex justify-end p-3">
                        <ResourceStatusIcon status={status} showLabel />
                    </div>
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

function pickFocusedDeployment(deployments: Deployment[], preferredUuid: string | null): string | null {
    if (preferredUuid && deployments.some((deployment) => deployment.uuid === preferredUuid)) {
        return preferredUuid;
    }

    const active = deployments.find((deployment) => isDeploymentActive(deployment.status));

    return active?.uuid ?? deployments[0]?.uuid ?? null;
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
    const [acting, setActing] = useState<CoreAction | null>(null);
    const [pendingAction, setPendingAction] = useState<CoreAction | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);
    const [focusedDeploymentUuid, setFocusedDeploymentUuid] = useState<string | null>(null);

    const resource = resourceQuery.data?.data;
    const status = resource?.status ?? 'unknown';
    const config = resource ? parseApplicationConfiguration(resource.configuration) : null;
    const domain = config ? primaryDomain(config.domains) : null;
    const deployments = deploymentsQuery.data?.data ?? [];
    const latest = latestDeployment(deployments);
    const visit = visitUrl(domain);
    const selectedDeployment = deployments.find((deployment) => deployment.uuid === focusedDeploymentUuid) ?? null;
    const hasActiveDeployment = deployments.some((deployment) => isDeploymentActive(deployment.status));

    useEffect(() => {
        setFocusedDeploymentUuid((current) => pickFocusedDeployment(deployments, current));
    }, [deployments]);

    useEffect(() => {
        if (!hasActiveDeployment) {
            return;
        }

        const interval = window.setInterval(() => {
            void deploymentsQuery.reload({ silent: true });
        }, 3000);

        return () => window.clearInterval(interval);
    }, [hasActiveDeployment, uuid]);

    const reload = async () => {
        await Promise.all([resourceQuery.reload(), deploymentsQuery.reload()]);
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
                setFocusedDeploymentUuid(deploymentUuid);
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
                <div class="grid gap-5">
                    <div class="flex flex-wrap items-start justify-between gap-4">
                        <div class="grid gap-2">
                            <button class="btn btn-ghost btn-sm -ms-2 w-fit rounded-full px-3" type="button" onClick={onClose}>
                                <ArrowLeft class="size-4" aria-hidden />
                                Applications
                            </button>
                            <div>
                                <h2 class="text-2xl font-bold tracking-tight sm:text-3xl">{resource.name}</h2>
                                <p class="text-sm text-base-content/55">
                                    {[config.project?.name, config.environment?.name].filter(Boolean).join(' · ') || 'Application sans projet'}
                                </p>
                            </div>
                        </div>
                        <div class="flex flex-wrap items-center gap-2">
                            {visit && (
                                <a class="btn btn-primary btn-sm rounded-full" href={visit} rel="noreferrer" target="_blank">
                                    <ExternalLink class="size-3.5" aria-hidden />
                                    Visiter
                                </a>
                            )}
                            {canAct && resource.actions.map((action) => {
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
                        </div>
                    </div>

                    <section class="overflow-hidden rounded-2xl border border-base-300/70 bg-base-100 shadow-sm">
                        <div class="flex flex-wrap items-center justify-between gap-3 border-b border-base-300/70 px-5 py-4">
                            <div>
                                <p class="text-sm font-semibold">Déploiement de production</p>
                                <p class="text-xs text-base-content/50">État actuel et source de déploiement</p>
                            </div>
                            {latest && (
                                <p class="text-xs text-base-content/45">
                                    Dernier déploiement {relativeUpdatedAt(latest.finished_at ?? latest.created_at)}
                                </p>
                            )}
                        </div>

                        <div class="grid gap-5 p-5 lg:grid-cols-[minmax(220px,280px)_1fr]">
                            <PreviewPanel name={resource.name} domain={domain} status={typeof status === 'string' ? status : 'running:healthy'} />

                            <dl class="min-w-0">
                                <DetailRow label="Déploiement">
                                    <span class="font-mono text-xs text-base-content/70">{resource.uuid}</span>
                                </DetailRow>
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
                                <DetailRow label="Statut">
                                    <ResourceStatusIcon status={status} showLabel size="md" />
                                </DetailRow>
                                <DetailRow label="Mis à jour">
                                    <span>{formatDateTime(resource.updated_at)}</span>
                                </DetailRow>
                                <DetailRow label="Source">
                                    <div class="grid gap-1">
                                        <span class="inline-flex items-center gap-2">
                                            <GitBranch class="size-3.5 text-base-content/45" aria-hidden />
                                            <span class="font-medium">{config.git_branch ?? 'branche inconnue'}</span>
                                        </span>
                                        {latest?.commit && (
                                            <span class="font-mono text-xs text-base-content/55">
                                                {shortCommit(latest.commit)}
                                                {latest.commit_message ? ` · ${latest.commit_message}` : ''}
                                            </span>
                                        )}
                                        {!latest?.commit && config.git_repository && (
                                            <span class="text-xs text-base-content/55">{repositoryLabel(config.git_repository)}</span>
                                        )}
                                    </div>
                                </DetailRow>
                            </dl>
                        </div>
                    </section>

                    <div class="grid gap-4 md:grid-cols-3">
                        <MetricCard title="Build">
                            <p><span class="text-base-content/45">Pack </span><span class="font-medium">{config.build_pack ?? '—'}</span></p>
                            <p><span class="text-base-content/45">Branche </span><span class="font-medium">{config.git_branch ?? '—'}</span></p>
                        </MetricCard>
                        <MetricCard title="Git">
                            <p class="truncate">
                                <span class="text-base-content/45">Dépôt </span>
                                <span class="font-medium">{repositoryLabel(config.git_repository) ?? '—'}</span>
                            </p>
                            <p><span class="text-base-content/45">Dernier commit </span><span class="font-mono text-xs">{shortCommit(latest?.commit ?? null) ?? '—'}</span></p>
                        </MetricCard>
                        <MetricCard title="Infrastructure">
                            <p><span class="text-base-content/45">Serveur </span><span class="font-medium">{config.server?.name ?? '—'}</span></p>
                            <p><span class="text-base-content/45">Environnement </span><span class="font-medium">{config.environment?.name ?? '—'}</span></p>
                        </MetricCard>
                    </div>

                    <ConnectDatabasePanel
                        applicationUuid={resource.uuid}
                        canAct={canAct}
                        onConnected={reload}
                    />

                    {focusedDeploymentUuid && (
                        <section class="grid gap-3">
                            <div class="flex flex-wrap items-center justify-between gap-3">
                                <div>
                                    <p class="text-sm font-semibold">Suivi du déploiement</p>
                                    <p class="text-xs text-base-content/50">
                                        Logs en direct et intervention de l’agent IA
                                    </p>
                                </div>
                                {selectedDeployment && (
                                    <DeploymentStatusIcon status={selectedDeployment.status} showLabel />
                                )}
                            </div>
                            <DeploymentMonitorPanel
                                deploymentUuid={focusedDeploymentUuid}
                                deployment={selectedDeployment}
                                onSelectDeployment={setFocusedDeploymentUuid}
                            />
                        </section>
                    )}

                    <ApplicationLogsPanel applicationUuid={resource.uuid} />

                    <section class="rounded-2xl border border-base-300/70 bg-base-100 shadow-sm">
                        <div class="flex items-center justify-between gap-3 border-b border-base-300/70 px-5 py-4">
                            <div>
                                <p class="text-sm font-semibold">Déploiements récents</p>
                                <p class="text-xs text-base-content/50">Historique des livraisons pour cette application</p>
                            </div>
                            <Server class="size-4 text-base-content/35" aria-hidden />
                        </div>

                        <DataState
                            loading={deploymentsQuery.loading}
                            error={deploymentsQuery.error}
                            empty={deployments.length === 0}
                            emptyMessage="Aucun déploiement enregistré pour cette application."
                            onRetry={() => void deploymentsQuery.reload()}
                        >
                            <div class="overflow-x-auto px-2 pb-2">
                                <Table headers={['Statut', 'Commit', 'Message', 'Date', 'Suivi']} caption="Déploiements récents">
                                    {deployments.map((deployment) => {
                                        const selected = deployment.uuid === focusedDeploymentUuid;

                                        return (
                                        <tr
                                            class={selected ? 'bg-primary/5' : 'cursor-pointer hover:bg-base-200/40'}
                                            key={deployment.uuid}
                                            onClick={() => setFocusedDeploymentUuid(deployment.uuid)}
                                        >
                                            <td>
                                                <DeploymentStatusIcon status={deployment.status} showLabel />
                                            </td>
                                            <td class="font-mono text-xs">{shortCommit(deployment.commit) ?? '—'}</td>
                                            <td class="max-w-xs truncate text-sm">{deployment.commit_message ?? '—'}</td>
                                            <td class="whitespace-nowrap text-xs text-base-content/55">
                                                {formatDateTime(deployment.finished_at ?? deployment.created_at)}
                                            </td>
                                            <td class="text-end">
                                                <button
                                                    class={`btn btn-ghost btn-xs ${selected ? 'text-primary' : ''}`}
                                                    type="button"
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        setFocusedDeploymentUuid(deployment.uuid);
                                                    }}
                                                >
                                                    <FileText class="size-3.5" aria-hidden />
                                                    {selected ? 'Suivi actif' : 'Suivre'}
                                                </button>
                                            </td>
                                        </tr>
                                        );
                                    })}
                                </Table>
                            </div>
                        </DataState>
                    </section>

                    {resource.description && (
                        <section class="rounded-2xl border border-base-300/70 bg-base-100 p-5 text-sm text-base-content/65 shadow-sm">
                            {resource.description}
                        </section>
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
