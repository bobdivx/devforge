import { Activity, Bot, Boxes, Database, RefreshCw, Server } from 'lucide-preact';
import { PageHeader } from '../../components/PageHeader';
import { Card } from '../../components/ui/Card';
import { DataState } from '../../components/ui/DataState';
import { DonutChart } from '../../components/ui/DonutChart';
import { ProgressBar } from '../../components/ui/ProgressBar';
import { ResourceStatusIcon } from '../../components/ui/ResourceStatusIcon';
import { SkeletonCard } from '../../components/ui/Skeleton';
import { StatCard } from '../../components/ui/StatCard';
import { DeploymentStatusIcon } from '../../components/ui/DeploymentStatusIcon';
import { Table } from '../../components/ui/Table';
import { AgentAvatar } from '../../components/agents/AgentAvatar';
import { parseResourceStatus } from '../../lib/resource-status';
import { domainApi, type ResourceStatus } from '../../lib/domain-api';
import { dayGreeting, formatDashboardDate } from '../../lib/greeting';
import { routeHref, applicationPath } from '../../lib/routes';
import { useApiQuery } from '../../lib/use-api-query';
import { useNavigate } from '../../lib/use-navigate';

function summarizeResources(resources: ResourceStatus[]) {
    const parsed = resources.map((resource) => parseResourceStatus(resource.status));
    const running = parsed.filter(({ tone }) => tone === 'success').length;
    const degraded = parsed.filter(({ tone }) => tone === 'warning').length;
    const stopped = parsed.filter(({ tone }) => tone === 'error').length;

    return { total: resources.length, running, degraded, stopped };
}

function ApplicationQuickCard({
    application,
    onNavigate,
}: {
    application: ResourceStatus;
    onNavigate: (event: MouseEvent, path: string) => void;
}) {
    return (
        <a
            class="flex min-w-0 items-center justify-between gap-2 sm:gap-3 rounded-2xl bg-base-200/80 px-2.5 sm:px-3 md:px-3 sm:px-4 py-2.5 sm:py-3.5 transition hover:bg-base-200"
            href={routeHref(applicationPath(application.uuid))}
            onClick={(event) => onNavigate(event, applicationPath(application.uuid))}
        >
            <div class="min-w-0">
                <p class="truncate text-xs sm:text-sm font-semibold">{application.name}</p>
                <p class="truncate text-xs text-base-content/45">Application</p>
            </div>
            <ResourceStatusIcon status={application.status} />
        </a>
    );
}

type OverviewPageProps = {
    userName?: string;
};

export function OverviewPage({ userName = '' }: OverviewPageProps) {
    const onNavigate = useNavigate();
    const query = useApiQuery('overview', () => domainApi.overview());
    const overview = query.data?.data;
    const applications = overview?.resource_statuses.applications ?? [];
    const databases = overview?.resource_statuses.databases ?? [];
    const services = overview?.resource_statuses.services ?? [];
    const servers = overview?.resource_statuses.servers ?? [];
    const health = overview?.health;
    const appHealth = summarizeResources(applications);
    const agentsEnabled = overview?.agents_summary !== null && overview?.agents_summary !== undefined;
    const healthTone = !health
        ? 'default'
        : health.score >= 80
            ? 'success'
            : health.score >= 50
                ? 'warning'
                : 'error';

    return (
        <div class="grid min-w-0 gap-6">
            <PageHeader
                eyebrow="Santé"
                title={userName ? dayGreeting(userName) : 'Vue d’ensemble'}
                description={formatDashboardDate()}
                actions={(
                    <button class="btn btn-ghost btn-sm border border-base-300/80" type="button" onClick={() => void query.reload()}>
                        <RefreshCw class="size-3.5" aria-hidden />
                        Actualiser
                    </button>
                )}
            />

            {query.loading && (
                <div class="grid min-w-0 gap-2 sm:gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    {Array.from({ length: 4 }).map((_, index) => <SkeletonCard key={index} />)}
                </div>
            )}

            <DataState loading={false} error={query.error} onRetry={() => void query.reload()}>
                {overview && health && (
                    <div class="grid min-w-0 gap-6">
                        <div class="grid min-w-0 gap-2.5 sm:gap-3 md:gap-4 sm:grid-cols-2 xl:grid-cols-4">
                            <StatCard
                                label="Santé plateforme"
                                value={`${health.score}%`}
                                hint={`${health.running} / ${health.total_resources} ressources en ligne`}
                                tone={healthTone}
                                icon={Activity}
                            />
                            <StatCard
                                label="Applications"
                                value={appHealth.total}
                                hint={`${appHealth.running} en ligne`}
                                href="/applications"
                                icon={Boxes}
                                onNavigate={onNavigate}
                            />
                            <StatCard
                                label="Bases & services"
                                value={databases.length + services.length}
                                hint={`${databases.length} bases · ${services.length} services`}
                                href="/databases"
                                icon={Database}
                                onNavigate={onNavigate}
                            />
                            {agentsEnabled && overview.agents_summary ? (
                                <StatCard
                                    label="Agents IA"
                                    value={overview.agents_summary.active}
                                    hint={`${overview.agents_summary.running} en cours`}
                                    tone="success"
                                    href="/agents"
                                    icon={Bot}
                                    onNavigate={onNavigate}
                                />
                            ) : (
                                <StatCard
                                    label="Serveurs"
                                    value={servers.length}
                                    hint="Infrastructure"
                                    href="/settings/servers"
                                    icon={Server}
                                    onNavigate={onNavigate}
                                />
                            )}
                        </div>

                        <div class="grid min-w-0 gap-2.5 sm:gap-3 md:gap-2.5 sm:gap-3 md:gap-4 xl:grid-cols-3">
                            <Card title="Disponibilité" eyebrow="Pipeline" class="min-w-0 xl:col-span-2">
                                <div class="flex min-w-0 flex-col gap-6 lg:flex-row lg:items-center">
                                    <DonutChart
                                        size={148}
                                        centerLabel={`${health.score}%`}
                                        segments={[
                                            { label: 'OK', value: health.running, color: 'var(--color-success)' },
                                            { label: 'Dégradé', value: health.degraded, color: 'var(--color-warning)' },
                                            { label: 'Arrêté', value: health.stopped, color: 'var(--color-error)' },
                                        ]}
                                    />
                                    <div class="grid min-w-0 flex-1 gap-2.5 sm:gap-3 md:gap-4">
                                        <div class="grid gap-2 sm:gap-3 sm:grid-cols-3">
                                            <p class="text-sm"><span class="font-semibold tabular-nums">{health.running}</span> <span class="text-base-content/50">en ligne</span></p>
                                            <p class="text-sm"><span class="font-semibold tabular-nums">{health.degraded}</span> <span class="text-base-content/50">dégradées</span></p>
                                            <p class="text-sm"><span class="font-semibold tabular-nums">{health.stopped}</span> <span class="text-base-content/50">arrêtées</span></p>
                                        </div>
                                        <ProgressBar
                                            value={health.score}
                                            label="Disponibilité globale"
                                            tone={health.score >= 80 ? 'success' : health.score >= 50 ? 'warning' : 'error'}
                                        />
                                        <ul class="grid gap-2 text-xs sm:grid-cols-2">
                                            <li class="flex justify-between rounded-xl bg-base-200/70 px-3 py-2">
                                                <span class="text-base-content/55">Applications</span>
                                                <span class="tabular-nums font-medium">{appHealth.running}/{appHealth.total}</span>
                                            </li>
                                            <li class="flex justify-between rounded-xl bg-base-200/70 px-3 py-2">
                                                <span class="text-base-content/55">Bases</span>
                                                <span class="tabular-nums font-medium">{summarizeResources(databases).running}/{databases.length}</span>
                                            </li>
                                            <li class="flex justify-between rounded-xl bg-base-200/70 px-3 py-2">
                                                <span class="text-base-content/55">Services</span>
                                                <span class="tabular-nums font-medium">{summarizeResources(services).running}/{services.length}</span>
                                            </li>
                                            <li class="flex justify-between rounded-xl bg-base-200/70 px-3 py-2">
                                                <span class="text-base-content/55">Serveurs</span>
                                                <span class="tabular-nums font-medium">{summarizeResources(servers).running}/{servers.length}</span>
                                            </li>
                                        </ul>
                                    </div>
                                </div>
                            </Card>

                            <Card title="Applications" eyebrow="État" class="min-w-0">
                                {applications.length === 0 ? (
                                    <div class="grid gap-2 sm:gap-3 py-6 text-center">
                                        <p class="text-sm text-base-content/55">Aucune application dans cette équipe.</p>
                                        <a class="btn btn-primary btn-sm mx-auto" href={routeHref('/applications')} onClick={(event) => onNavigate(event, '/applications')}>
                                            <Boxes class="size-3.5" aria-hidden />
                                            Voir les applications
                                        </a>
                                    </div>
                                ) : (
                                    <div class="grid min-w-0 gap-2">
                                        {applications.slice(0, 6).map((application) => (
                                            <ApplicationQuickCard application={application} onNavigate={onNavigate} key={application.uuid} />
                                        ))}
                                    </div>
                                )}
                            </Card>
                        </div>

                        <div class="grid min-w-0 gap-2.5 sm:gap-3 md:gap-2.5 sm:gap-3 md:gap-4 xl:grid-cols-2">
                            <Card title="Déploiements récents" eyebrow="Activité" class="min-w-0">
                                {overview.recent_deployments.length === 0 ? (
                                    <p class="py-3 sm:py-4 text-center text-xs text-base-content/50">Aucun déploiement récent.</p>
                                ) : (
                                    <div class="min-w-0 overflow-x-auto">
                                        <Table headers={['Application', 'Statut', 'Date']} caption="Déploiements récents">
                                            {overview.recent_deployments.map((deployment) => (
                                                <tr key={deployment.uuid}>
                                                    <td class="max-w-[10rem] truncate font-medium sm:max-w-none">
                                                        <a class="hover:text-primary" href={routeHref('/deployments')} onClick={(event) => onNavigate(event, '/deployments')}>
                                                            {deployment.application?.name ?? '—'}
                                                        </a>
                                                    </td>
                                                    <td class="whitespace-nowrap">
                                                        <DeploymentStatusIcon status={deployment.status} showLabel />
                                                    </td>
                                                    <td class="whitespace-nowrap text-xs text-base-content/55">
                                                        {deployment.created_at ? new Date(deployment.created_at).toLocaleString('fr-FR') : '—'}
                                                    </td>
                                                </tr>
                                            ))}
                                        </Table>
                                    </div>
                                )}
                            </Card>

                            {agentsEnabled && overview.agents_summary && (
                                <Card
                                    title="Agents IA"
                                    eyebrow={`${overview.agents_summary.active} actifs · ${overview.agents_summary.running} en cours`}
                                    class="min-w-0"
                                >
                                    {overview.agent_activity.length === 0 ? (
                                        <div class="grid gap-2 sm:gap-3 py-6 text-center">
                                            <p class="text-sm text-base-content/55">Aucune activité récente.</p>
                                            <a class="btn btn-ghost btn-sm mx-auto border border-base-300/80" href={routeHref('/agents')} onClick={(event) => onNavigate(event, '/agents')}>
                                                <Bot class="size-3.5" aria-hidden />
                                                Ouvrir les agents
                                            </a>
                                        </div>
                                    ) : (
                                        <>
                                            <ul class="min-w-0 divide-y divide-base-300/70">
                                                {overview.agent_activity.map((activity) => (
                                                    <li class="flex min-w-0 items-start gap-2 sm:gap-3 py-3 sm:items-center" key={activity.uuid}>
                                                        {activity.agent && (
                                                            <AgentAvatar
                                                                type={activity.agent.type}
                                                                color={activity.agent.avatar_color}
                                                                shape={activity.agent.avatar_shape}
                                                                name={activity.agent.name}
                                                                size="sm"
                                                                status={activity.status === 'failed' ? 'error' : activity.status === 'completed' ? 'idle' : 'running'}
                                                                animate={activity.status !== 'completed' && activity.status !== 'failed'}
                                                            />
                                                        )}
                                                        <div class="min-w-0 flex-1 overflow-hidden">
                                                            <p class="truncate text-xs sm:text-sm font-medium">{activity.agent?.name ?? 'Agent'}</p>
                                                            <p class="line-clamp-2 break-words text-xs text-base-content/55 sm:line-clamp-1">
                                                                {activity.summary || 'Exécution sans résumé'}
                                                            </p>
                                                        </div>
                                                        <div class="shrink-0">
                                                            <ResourceStatusIcon
                                                                status={activity.status === 'completed' ? 'running:healthy' : activity.status === 'failed' ? 'exited' : 'starting:unknown'}
                                                                showLabel
                                                            />
                                                        </div>
                                                    </li>
                                                ))}
                                            </ul>
                                            <div class="card-toolbar mt-3">
                                                <a class="btn btn-ghost btn-sm border border-base-300/80" href={routeHref('/agents')} onClick={(event) => onNavigate(event, '/agents')}>
                                                    <Bot class="size-3.5" aria-hidden />
                                                    Voir les agents
                                                </a>
                                            </div>
                                        </>
                                    )}
                                </Card>
                            )}
                        </div>
                    </div>
                )}
            </DataState>
        </div>
    );
}
