import { Bot, Boxes, RefreshCw } from 'lucide-preact';
import { PageHeader } from '../components/PageHeader';
import { Card } from '../components/ui/Card';
import { DataState } from '../components/ui/DataState';
import { DonutChart } from '../components/ui/DonutChart';
import { ProgressBar } from '../components/ui/ProgressBar';
import { ResourceStatusIcon } from '../components/ui/ResourceStatusIcon';
import { SkeletonCard } from '../components/ui/Skeleton';
import { StatCard } from '../components/ui/StatCard';
import { DeploymentStatusIcon } from '../components/ui/DeploymentStatusIcon';
import { Table } from '../components/ui/Table';
import { parseResourceStatus } from '../lib/resource-status';
import { domainApi, type ResourceStatus } from '../lib/domain-api';
import { routeHref, applicationPath } from '../lib/routes';
import { useApiQuery } from '../lib/use-api-query';
import { useNavigate } from '../lib/use-navigate';

function summarizeApplications(applications: ResourceStatus[]) {
    const parsed = applications.map((app) => parseResourceStatus(app.status));
    const running = parsed.filter(({ tone }) => tone === 'success').length;
    const degraded = parsed.filter(({ tone }) => tone === 'warning').length;
    const stopped = parsed.filter(({ tone }) => tone === 'error').length;
    const total = applications.length;
    const score = total > 0 ? Math.round((running / total) * 100) : 100;

    return { total, running, degraded, stopped, score };
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
            class="flex min-w-0 items-center justify-between gap-3 rounded-2xl border border-base-300/70 bg-base-100 p-4 shadow-sm transition hover:border-primary/30 hover:shadow-md"
            href={routeHref(applicationPath(application.uuid))}
            onClick={(event) => onNavigate(event, applicationPath(application.uuid))}
        >
            <div class="min-w-0">
                <p class="truncate text-sm font-semibold">{application.name}</p>
                <p class="truncate text-xs text-base-content/45">Application</p>
            </div>
            <ResourceStatusIcon status={application.status} />
        </a>
    );
}

export function OverviewPage() {
    const onNavigate = useNavigate();
    const query = useApiQuery('overview', () => domainApi.overview());
    const overview = query.data?.data;
    const applications = overview?.resource_statuses.applications ?? [];
    const appHealth = summarizeApplications(applications);
    const agentsEnabled = overview?.agents_summary !== null && overview?.agents_summary !== undefined;

    return (
        <div class="grid min-w-0 gap-5">
            <PageHeader
                title="Vue d’ensemble"
                description="Applications, déploiements récents et activité des agents."
                actions={(
                    <button class="btn btn-ghost btn-sm rounded-full border border-base-300/80" type="button" onClick={() => void query.reload()}>
                        <RefreshCw class="size-3.5" aria-hidden />
                        Actualiser
                    </button>
                )}
            />

            {query.loading && (
                <div class="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {Array.from({ length: 3 }).map((_, index) => <SkeletonCard key={index} />)}
                </div>
            )}

            <DataState loading={false} error={query.error} onRetry={() => void query.reload()}>
                {overview && (
                    <div class="grid min-w-0 gap-5">
                        <div class="grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-3">
                            <Card title="Santé des applications" class="min-w-0">
                                <div class="flex min-w-0 flex-col items-center gap-4 sm:flex-row sm:items-center">
                                    <DonutChart
                                        centerLabel={`${appHealth.score}%`}
                                        segments={[
                                            { label: 'OK', value: appHealth.running, color: 'var(--color-success)' },
                                            { label: 'Dégradé', value: appHealth.degraded, color: 'var(--color-warning)' },
                                            { label: 'Arrêté', value: appHealth.stopped, color: 'var(--color-error)' },
                                        ]}
                                    />
                                    <div class="grid w-full min-w-0 gap-2 text-xs sm:flex-1">
                                        <p><span class="font-medium">{appHealth.running}</span> en ligne</p>
                                        <p><span class="font-medium">{appHealth.degraded}</span> dégradées</p>
                                        <p><span class="font-medium">{appHealth.stopped}</span> arrêtées</p>
                                    </div>
                                </div>
                                <ProgressBar
                                    value={appHealth.score}
                                    label="Disponibilité"
                                    tone={appHealth.score >= 80 ? 'success' : appHealth.score >= 50 ? 'warning' : 'error'}
                                />
                            </Card>

                            <StatCard
                                label="Applications"
                                value={appHealth.total}
                                hint="Voir et gérer vos apps"
                                href="/applications"
                                onNavigate={onNavigate}
                            />

                            {agentsEnabled && overview.agents_summary && (
                                <StatCard
                                    label="Agents IA"
                                    value={overview.agents_summary.active}
                                    hint={`${overview.agents_summary.running} en cours`}
                                    tone="success"
                                    href="/agents"
                                    onNavigate={onNavigate}
                                />
                            )}
                        </div>

                        <Card title="Applications" eyebrow="Accès rapide" class="min-w-0">
                            {applications.length === 0 ? (
                                <div class="grid gap-3 py-6 text-center">
                                    <p class="text-sm text-base-content/55">Aucune application dans cette équipe.</p>
                                    <a class="btn btn-primary btn-sm mx-auto rounded-full" href={routeHref('/applications')} onClick={(event) => onNavigate(event, '/applications')}>
                                        <Boxes class="size-3.5" aria-hidden />
                                        Voir les applications
                                    </a>
                                </div>
                            ) : (
                                <div class="grid min-w-0 gap-3 sm:grid-cols-2 2xl:grid-cols-3">
                                    {applications.map((application) => (
                                        <ApplicationQuickCard application={application} onNavigate={onNavigate} key={application.uuid} />
                                    ))}
                                </div>
                            )}
                        </Card>

                        <div class="grid min-w-0 gap-5 xl:grid-cols-2">
                            <Card title="Déploiements récents" eyebrow="Activité" class="min-w-0">
                                {overview.recent_deployments.length === 0 ? (
                                    <p class="py-4 text-center text-xs text-base-content/50">Aucun déploiement récent.</p>
                                ) : (
                                    <div class="min-w-0 overflow-x-auto">
                                        <Table headers={['Application', 'Statut', 'Date']} caption="Déploiements récents">
                                            {overview.recent_deployments.map((deployment) => (
                                                <tr key={deployment.uuid}>
                                                    <td class="max-w-[10rem] truncate font-medium sm:max-w-none">
                                                        <a class="hover:text-primary" href={routeHref('/deployments')} onClick={(event) => onNavigate(event, '/deployments')}>
                                                            {deployment.application.name}
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
                                        <div class="grid gap-3 py-6 text-center">
                                            <p class="text-sm text-base-content/55">Aucune activité récente.</p>
                                            <a class="btn btn-ghost btn-sm mx-auto rounded-full border border-base-300/80" href={routeHref('/agents')} onClick={(event) => onNavigate(event, '/agents')}>
                                                <Bot class="size-3.5" aria-hidden />
                                                Ouvrir les agents
                                            </a>
                                        </div>
                                    ) : (
                                        <>
                                            <ul class="divide-y divide-base-300/70">
                                                {overview.agent_activity.map((activity) => (
                                                    <li class="flex min-w-0 items-center justify-between gap-3 py-3" key={activity.uuid}>
                                                        <div class="min-w-0">
                                                            <p class="truncate text-sm font-medium">{activity.agent?.name ?? 'Agent'}</p>
                                                            <p class="truncate text-xs text-base-content/55">{activity.summary || 'Exécution sans résumé'}</p>
                                                        </div>
                                                        <ResourceStatusIcon
                                                            status={activity.status === 'completed' ? 'running:healthy' : activity.status === 'failed' ? 'exited' : 'starting:unknown'}
                                                            showLabel
                                                        />
                                                    </li>
                                                ))}
                                            </ul>
                                            <div class="mt-3 flex justify-end">
                                                <a class="btn btn-ghost btn-sm rounded-full border border-base-300/80" href={routeHref('/agents')} onClick={(event) => onNavigate(event, '/agents')}>
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
