import { ArrowRight, Bot, RefreshCw, Rocket } from 'lucide-preact';
import { useEffect } from 'preact/hooks';
import { AgentAvatar } from '../agents/AgentAvatar';
import { AgentRunLog } from '../agents/AgentRunLog';
import { AgentRunStatusBadge } from '../agents/AgentRunStatusBadge';
import { DataState } from '../ui/DataState';
import { DeploymentStatusIcon } from '../ui/DeploymentStatusIcon';
import { domainApi, type DeploymentAgentRun } from '../../lib/domain-api';
import { formatDateTime } from '../../lib/application-config';
import { useApiQuery } from '../../lib/use-api-query';

type Props = {
    deploymentUuid: string;
    onSelectDeployment?: (deploymentUuid: string) => void;
    pollWhileActive?: boolean;
};

function eventLabel(event?: string | null): string {
    if (event === 'deployment_failed') {
        return 'Correction après échec';
    }

    if (event === 'deployment_build_started') {
        return 'Surveillance du build';
    }

    return 'Intervention agent';
}

export function DeploymentAgentCard({ deploymentUuid, onSelectDeployment, pollWhileActive = true }: Props) {
    const query = useApiQuery(
        `deployment-monitoring:${deploymentUuid}`,
        () => domainApi.deploymentMonitoring(deploymentUuid),
    );
    const monitoring = query.data?.data ?? null;
    const hasActiveRun = monitoring?.agent_runs.some((run) => run.status === 'pending' || run.status === 'running') ?? false;

    useEffect(() => {
        if (!pollWhileActive || !hasActiveRun) {
            return;
        }

        const interval = window.setInterval(() => {
            void query.reload({ silent: true });
        }, 3000);

        return () => window.clearInterval(interval);
    }, [hasActiveRun, pollWhileActive, deploymentUuid]);

    return (
        <section class="rounded-2xl border border-base-300/70 bg-base-100 shadow-sm">
            <div class="flex flex-wrap items-center justify-between gap-3 border-b border-base-300/70 px-5 py-4">
                <div>
                    <p class="text-sm font-semibold">Agent de déploiement</p>
                    <p class="text-xs text-base-content/50">Surveillance, diagnostics et relance automatique</p>
                </div>
                <button class="btn btn-ghost btn-sm" type="button" onClick={() => void query.reload()}>
                    <RefreshCw class="size-3.5" aria-hidden />
                    Actualiser
                </button>
            </div>

            <div class="grid gap-4 p-5">
                <DataState loading={query.loading} error={query.error} onRetry={() => void query.reload()}>
                    {monitoring && (
                        <>
                            {!monitoring.agents.enabled && (
                                <p class="rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                                    Les agents IA sont désactivés. Activez <code class="font-mono">DEVFORGE_AGENTS_ENABLED</code> pour la surveillance automatique.
                                </p>
                            )}

                            {monitoring.agents.enabled && !monitoring.agents.auto_fix_deployments && monitoring.deployment.status.includes('fail') && (
                                <p class="rounded-xl border border-base-300 bg-base-200/60 px-3 py-2 text-xs text-base-content/65">
                                    L’auto-correction des déploiements est désactivée. Aucun agent ne sera déclenché automatiquement après un échec.
                                </p>
                            )}

                            {monitoring.agent_runs.length === 0 ? (
                                <div class="flex items-center gap-3 rounded-xl border border-dashed border-base-300 px-4 py-5 text-sm text-base-content/55">
                                    <Bot class="size-5 shrink-0 text-base-content/35" aria-hidden />
                                    <p>
                                        {monitoring.deployment.status.includes('fail')
                                            ? 'Aucun agent n’a encore été déclenché pour cet échec.'
                                            : 'Aucune intervention agent liée à ce déploiement.'}
                                    </p>
                                </div>
                            ) : monitoring.agent_runs.map((run) => (
                                <AgentRunCard
                                    key={run.uuid}
                                    deploymentUuid={deploymentUuid}
                                    run={run}
                                    onSelectDeployment={onSelectDeployment}
                                />
                            ))}

                            {monitoring.redeployments.length > 0 && (
                                <div class="rounded-xl border border-primary/20 bg-primary/5 p-4">
                                    <p class="mb-3 text-sm font-semibold text-primary">Redéploiements déclenchés par l’agent</p>
                                    <ul class="grid gap-2">
                                        {monitoring.redeployments.map((deployment) => (
                                            <li key={deployment.uuid}>
                                                <button
                                                    class="flex w-full items-center justify-between gap-3 rounded-lg border border-base-300/70 bg-base-100 px-3 py-2 text-left text-sm transition hover:border-primary/40"
                                                    type="button"
                                                    onClick={() => onSelectDeployment?.(deployment.uuid)}
                                                >
                                                    <span class="min-w-0">
                                                        <span class="block font-mono text-[11px] text-base-content/45">{deployment.uuid}</span>
                                                        <span class="block truncate">{deployment.commit_message ?? 'Nouveau déploiement'}</span>
                                                    </span>
                                                    <span class="flex items-center gap-2">
                                                        <DeploymentStatusIcon status={deployment.status} />
                                                        <ArrowRight class="size-3.5 text-base-content/35" aria-hidden />
                                                    </span>
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </>
                    )}
                </DataState>
            </div>
        </section>
    );
}

type AgentRunCardProps = {
    deploymentUuid: string;
    run: DeploymentAgentRun;
    onSelectDeployment?: (deploymentUuid: string) => void;
};

function AgentRunCard({ deploymentUuid, run, onSelectDeployment }: AgentRunCardProps) {
    const event = typeof run.event_context?.event === 'string' ? run.event_context.event : null;

    return (
        <article class="rounded-xl border border-base-300/70 bg-base-200/20 p-4">
            <div class="mb-3 flex flex-wrap items-start justify-between gap-3">
                <div class="flex min-w-0 items-start gap-3">
                    {run.agent ? (
                        <AgentAvatar
                            type={run.agent.type}
                            color={run.agent.avatar_color}
                            name={run.agent.name}
                            size="sm"
                        />
                    ) : (
                        <div class="grid size-8 place-items-center rounded-xl bg-base-300 text-base-content/50">
                            <Bot class="size-4" aria-hidden />
                        </div>
                    )}
                    <div class="min-w-0">
                        <p class="font-medium">{run.agent?.name ?? 'Agent'}</p>
                        <p class="text-xs text-base-content/50">{eventLabel(event)}</p>
                        {run.summary && <p class="mt-1 text-sm text-base-content/70">{run.summary}</p>}
                    </div>
                </div>
                <AgentRunStatusBadge status={run.status} />
            </div>

            <dl class="mb-3 grid gap-1 text-xs text-base-content/55 sm:grid-cols-3">
                <div><dt class="inline">Itérations </dt><dd class="inline font-medium text-base-content">{run.iterations}</dd></div>
                <div><dt class="inline">Démarré </dt><dd class="inline font-medium text-base-content">{formatDateTime(run.started_at ?? run.created_at)}</dd></div>
                <div><dt class="inline">Terminé </dt><dd class="inline font-medium text-base-content">{formatDateTime(run.finished_at)}</dd></div>
            </dl>

            {run.actions_taken.length > 0 && (
                <div class="mb-3">
                    <p class="mb-2 text-xs font-semibold uppercase tracking-wide text-base-content/45">Actions</p>
                    <ul class="grid gap-2">
                        {run.actions_taken.map((action, index) => (
                            <li
                                class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-base-300/60 bg-base-100 px-3 py-2 text-xs"
                                key={`${action.at}-${index}`}
                            >
                                <span>
                                    <span class="font-medium">{action.action}</span>
                                    <span class="text-base-content/45"> · {action.reason}</span>
                                </span>
                                {action.action === 'deploy' && action.deployment_uuid && action.deployment_uuid !== deploymentUuid && (
                                    <button
                                        class="btn btn-ghost btn-xs rounded-full"
                                        type="button"
                                        onClick={() => onSelectDeployment?.(action.deployment_uuid!)}
                                    >
                                        <Rocket class="size-3" aria-hidden />
                                        Voir le redéploiement
                                    </button>
                                )}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {run.logs && <AgentRunLog logs={run.logs} />}
        </article>
    );
}
