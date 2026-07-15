import { ArrowRight, Bot, ExternalLink, RefreshCw, Rocket } from 'lucide-preact';
import { useEffect } from 'preact/hooks';
import { AgentAvatar } from '../agents/AgentAvatar';
import { AgentRunLog } from '../agents/AgentRunLog';
import { AgentRunStatusBadge } from '../agents/AgentRunStatusBadge';
import { DataState } from '../ui/DataState';
import { DeploymentStatusIcon } from '../ui/DeploymentStatusIcon';
import { domainApi, type DeploymentAgentRun } from '../../lib/domain-api';
import { formatDateTime } from '../../lib/application-config';
import { agentDetailPath } from '../../lib/agent-routes';
import { routeHref } from '../../lib/routes';
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
    const blockers = monitoring?.diagnostics?.blockers ?? [];
    const hasActiveRun = monitoring?.agent_runs.some((run) => run.status === 'pending' || run.status === 'running') ?? false;
    const hasActiveSubagent = monitoring?.agent_runs.some((run) =>
        (run.subagent_runs ?? []).some((sub) => sub.status === 'pending' || sub.status === 'running'),
    ) ?? false;
    const awaitingAgent = Boolean(
        monitoring
        && monitoring.agent_runs.length === 0
        && (monitoring.deployment.status.includes('fail') || monitoring.deployment.status.includes('progress'))
        && (monitoring.diagnostics?.eligible_agents_count ?? 0) > 0,
    );
    const shouldPoll = pollWhileActive && (hasActiveRun || hasActiveSubagent || monitoring?.catch_up_triggered || awaitingAgent);

    useEffect(() => {
        if (!shouldPoll) {
            return;
        }

        const interval = window.setInterval(() => {
            void query.reload({ silent: true });
        }, 3000);

        return () => window.clearInterval(interval);
    }, [shouldPoll, pollWhileActive, deploymentUuid]);

    return (
        <section class="min-w-0 overflow-hidden rounded-2xl border border-base-300/70 bg-base-100 shadow-sm">
            <div class="toolbar-row border-b border-base-300/70 px-5 py-4">
                <div>
                    <p class="text-sm font-semibold">Agent de déploiement</p>
                    <p class="text-xs text-base-content/50">Surveillance, diagnostics et relance automatique</p>
                </div>
                <div class="card-toolbar w-full sm:w-auto">
                    <button class="btn btn-ghost btn-sm w-full sm:w-auto" type="button" onClick={() => void query.reload()}>
                    <RefreshCw class="size-3.5" aria-hidden />
                    Actualiser
                    </button>
                </div>
            </div>

            <div class="grid min-w-0 gap-4 overflow-hidden p-5">
                <DataState loading={query.loading} error={query.error} onRetry={() => void query.reload()}>
                    {monitoring && (
                        <>
                            {!monitoring.agents.enabled && (
                                <p class="rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                                    Les agents IA sont désactivés. Activez <code class="font-mono">DEVFORGE_AGENTS_ENABLED</code> pour la surveillance automatique.
                                </p>
                            )}

                            {monitoring.agents.enabled && !monitoring.agents.monitor_build && (
                                <p class="rounded-xl border border-base-300 bg-base-200/60 px-3 py-2 text-xs text-base-content/65">
                                    La surveillance des builds est désactivée. Aucun agent ne sera déclenché au démarrage d’un déploiement.
                                </p>
                            )}

                            {monitoring.agents.enabled && !monitoring.agents.auto_fix_deployments && monitoring.deployment.status.includes('fail') && (
                                <p class="rounded-xl border border-base-300 bg-base-200/60 px-3 py-2 text-xs text-base-content/65">
                                    L’auto-correction des déploiements est désactivée. Aucun agent ne sera déclenché automatiquement après un échec.
                                </p>
                            )}

                            {monitoring.agent_runs.length === 0 ? (
                                <div class="grid gap-3 rounded-xl border border-dashed border-base-300 px-4 py-5 text-sm text-base-content/55">
                                    <div class="flex items-center gap-3">
                                        <Bot class="size-5 shrink-0 text-base-content/35" aria-hidden />
                                        <p>
                                            {monitoring.deployment.status.includes('fail')
                                                ? 'Aucun agent n’a encore été déclenché pour cet échec.'
                                                : 'Aucune intervention agent liée à ce déploiement.'}
                                        </p>
                                    </div>
                                    {blockers.length > 0 && (
                                        <ul class="grid gap-2 border-t border-base-300/60 pt-3 text-xs">
                                            {blockers.map((blocker) => (
                                                <li class="rounded-lg border border-warning/25 bg-warning/5 px-3 py-2 text-warning" key={blocker.code}>
                                                    {blocker.message}
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                    {monitoring.catch_up_triggered && (
                                        <p class="border-t border-base-300/60 pt-3 text-xs text-primary">
                                            Agent déclenché — chargement de l&apos;intervention…
                                        </p>
                                    )}
                                    {shouldPoll && !monitoring.catch_up_triggered && monitoring.agent_runs.length === 0 && (
                                        <p class="border-t border-base-300/60 pt-3 text-xs text-primary">
                                            En attente de l&apos;agent — actualisation automatique…
                                        </p>
                                    )}
                                    {blockers.length === 0 && monitoring.diagnostics.eligible_agents_count > 0 && !monitoring.catch_up_triggered && !shouldPoll && (
                                        <p class="border-t border-base-300/60 pt-3 text-xs text-base-content/50">
                                            {monitoring.diagnostics.eligible_agents_count} agent(s) éligible(s).
                                            {' '}
                                            {monitoring.diagnostics.eligible_agents?.[0] ? (
                                                <a
                                                    class="link link-primary"
                                                    href={routeHref(agentDetailPath(monitoring.diagnostics.eligible_agents[0].uuid, { view: 'runs' }))}
                                                >
                                                    Voir {monitoring.diagnostics.eligible_agents[0].name} → Exécutions
                                                </a>
                                            ) : (
                                                'Actualisez après le déploiement pour lier l’intervention.'
                                            )}
                                        </p>
                                    )}
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
    const agentDetailHref = run.agent
        ? routeHref(agentDetailPath(run.agent.uuid, { view: 'runs', run: run.uuid }))
        : null;
    const ephemeralTasks = Array.isArray(run.metadata?.ephemeral_tasks)
        ? run.metadata.ephemeral_tasks as Array<{ goal?: string; status?: string; model_label?: string }>
        : [];
    const subagents = run.subagent_runs ?? [];

    return (
        <article class="min-w-0 overflow-hidden rounded-xl border border-base-300/70 bg-base-200/20 p-4">
            <div class="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div class="flex min-w-0 items-start gap-3 overflow-hidden">
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
                    <div class="min-w-0 flex-1 overflow-hidden">
                        <div class="flex min-w-0 flex-wrap items-center gap-2">
                            <p class="truncate font-medium">{run.agent?.name ?? 'Agent'}</p>
                            {agentDetailHref && (
                                <a
                                    class="btn btn-ghost btn-xs h-auto min-h-0 gap-1 px-1 text-[11px] text-primary"
                                    href={agentDetailHref}
                                >
                                    <ExternalLink class="size-3" aria-hidden />
                                    Détail
                                </a>
                            )}
                        </div>
                        <p class="text-xs text-base-content/50">{eventLabel(event)}</p>
                        {run.linkage === 'context' && (
                            <p class="mt-1 text-[10px] text-base-content/45">
                                Associé à cette période de déploiement (lancement manuel ou lien indirect)
                            </p>
                        )}
                        {run.summary && (
                            <p class="mt-1 line-clamp-2 break-words text-sm text-base-content/70 sm:line-clamp-3">
                                {run.summary}
                            </p>
                        )}
                    </div>
                </div>
                <div class="shrink-0 self-start">
                    <AgentRunStatusBadge status={run.status} />
                </div>
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

            {(subagents.length > 0 || ephemeralTasks.length > 0) && (
                <div class="mb-3 rounded-lg border border-base-300/60 bg-base-100/80 p-3">
                    <p class="mb-2 text-xs font-semibold uppercase tracking-wide text-base-content/45">Sous-agents</p>
                    <ul class="grid gap-2">
                        {subagents.map((sub) => (
                            <li
                                class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-base-300/50 px-3 py-2 text-xs"
                                key={sub.uuid}
                            >
                                <span class="min-w-0">
                                    <span class="font-medium">{sub.child_agent?.name ?? 'Sous-agent'}</span>
                                    {sub.reason && <span class="text-base-content/45"> · {sub.reason}</span>}
                                </span>
                                <AgentRunStatusBadge status={(sub.child_run?.status ?? sub.status) as DeploymentAgentRun['status']} />
                            </li>
                        ))}
                        {ephemeralTasks.map((task, index) => (
                            <li
                                class="rounded-lg border border-base-300/50 px-3 py-2 text-xs"
                                key={`ephemeral-${index}`}
                            >
                                <span class="font-medium">{task.model_label ?? 'Tâche éphémère'}</span>
                                {task.goal && <p class="mt-1 text-base-content/55">{task.goal}</p>}
                                {task.status && <p class="mt-1 text-base-content/45">{task.status}</p>}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {run.logs && (
                <div class="min-w-0 overflow-hidden">
                    <AgentRunLog logs={run.logs} class="max-h-80 w-full max-w-full" />
                </div>
            )}
        </article>
    );
}
