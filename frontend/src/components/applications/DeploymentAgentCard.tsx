import { ArrowRight, Bot, ChevronDown, ExternalLink, RefreshCw, Rocket } from 'lucide-preact';
import { useEffect, useState } from 'preact/hooks';
import { AgentAvatar } from '../agents/AgentAvatar';
import { AgentRunLog } from '../agents/AgentRunLog';
import { AgentRunStatusBadge } from '../agents/AgentRunStatusBadge';
import { DataState } from '../ui/DataState';
import { DeploymentStatusIcon } from '../ui/DeploymentStatusIcon';
import { domainApi, type DeploymentAgentCorrection, type DeploymentAgentRun } from '../../lib/domain-api';
import { formatDateTime } from '../../lib/application-config';
import { agentDetailPath } from '../../lib/agent-routes';
import { routeHref } from '../../lib/routes';
import { useApiQuery } from '../../lib/use-api-query';
import {
    outcomeLabel,
    outcomeToneClass,
    shortSha,
} from '../../lib/agent-correction-summary';
import { selectVisibleAgentRuns } from '../../lib/select-visible-agent-runs';

type Props = {
    deploymentUuid: string;
    onSelectDeployment?: (deploymentUuid: string) => void;
    pollWhileActive?: boolean;
    /** Affiche le dernier run terminé (ouvert depuis l’historique). */
    historyMode?: boolean;
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

export function DeploymentAgentCard({
    deploymentUuid,
    onSelectDeployment,
    pollWhileActive = true,
    historyMode = false,
}: Props) {
    const query = useApiQuery(
        `deployment-monitoring:${deploymentUuid}`,
        () => domainApi.deploymentMonitoring(deploymentUuid),
    );
    const monitoring = query.data?.data ?? null;
    const blockers = monitoring?.diagnostics?.blockers ?? [];
    const visibleRuns = monitoring
        ? selectVisibleAgentRuns(monitoring.agent_runs, { historyMode })
        : [];
    const hasActiveRun = monitoring?.agent_runs.some((run) => run.status === 'pending' || run.status === 'running') ?? false;
    const hasActiveSubagent = monitoring?.agent_runs.some((run) =>
        (run.subagent_runs ?? []).some((sub) => sub.status === 'pending' || sub.status === 'running'),
    ) ?? false;
    const awaitingAgent = Boolean(
        monitoring
        && visibleRuns.length === 0
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
            <div class="flex flex-wrap items-center justify-between gap-2 border-b border-base-300/70 px-3 py-3 sm:px-5 sm:py-4">
                <div class="min-w-0">
                    <p class="text-sm font-semibold">Agent IA</p>
                    <p class="text-xs text-base-content/50">Correction et surveillance du déploiement</p>
                </div>
                <button
                    class="btn btn-ghost btn-sm shrink-0 rounded-full border border-base-300/80"
                    type="button"
                    onClick={() => void query.reload()}
                    aria-label="Actualiser"
                >
                    <RefreshCw class="size-3.5" aria-hidden />
                    <span class="hidden sm:inline">Actualiser</span>
                </button>
            </div>

            <div class="grid min-w-0 gap-3 overflow-hidden p-3 sm:gap-4 sm:p-5">
                <DataState loading={query.loading} error={query.error} onRetry={() => void query.reload()}>
                    {monitoring && (
                        <>
                            {!monitoring.agents.enabled && (
                                <p class="rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                                    Les agents IA sont désactivés.
                                </p>
                            )}

                            {monitoring.agents.enabled && !monitoring.agents.monitor_build && (
                                <p class="rounded-xl border border-base-300 bg-base-200/60 px-3 py-2 text-xs text-base-content/65">
                                    Surveillance des builds désactivée.
                                </p>
                            )}

                            {monitoring.agents.enabled && !monitoring.agents.auto_fix_deployments && monitoring.deployment.status.includes('fail') && (
                                <p class="rounded-xl border border-base-300 bg-base-200/60 px-3 py-2 text-xs text-base-content/65">
                                    Auto-correction désactivée pour les échecs.
                                </p>
                            )}

                            {visibleRuns.length === 0 ? (
                                <div class="grid gap-3 rounded-xl border border-dashed border-base-300 px-3 py-4 text-sm text-base-content/55 sm:px-4 sm:py-5">
                                    <div class="flex items-start gap-3">
                                        <Bot class="mt-0.5 size-5 shrink-0 text-base-content/35" aria-hidden />
                                        <p>
                                            {historyMode
                                                ? 'Aucune intervention agent pour ce déploiement.'
                                                : monitoring.deployment.status.includes('fail')
                                                    ? 'Aucun agent en cours. Les interventions passées sont dans l’historique.'
                                                    : monitoring.agent_runs.some((run) => !run.historical_for_other_attempt)
                                                        ? 'Aucune intervention agent en cours. Les runs précédents sont dans l’historique.'
                                                        : 'Aucune intervention agent pour ce déploiement.'}
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
                                    {(monitoring.catch_up_triggered || (shouldPoll && visibleRuns.length === 0)) && (
                                        <p class="border-t border-base-300/60 pt-3 text-xs text-primary">
                                            En attente de l’agent…
                                        </p>
                                    )}
                                    {blockers.length === 0 && (monitoring.diagnostics?.eligible_agents_count ?? 0) > 0 && !monitoring.catch_up_triggered && !shouldPoll && monitoring.diagnostics.eligible_agents?.[0] && (
                                        <p class="border-t border-base-300/60 pt-3 text-xs text-base-content/50">
                                            <a
                                                class="link link-primary"
                                                href={routeHref(agentDetailPath(monitoring.diagnostics.eligible_agents[0].uuid, { view: 'runs' }))}
                                            >
                                                Voir {monitoring.diagnostics.eligible_agents[0].name}
                                            </a>
                                        </p>
                                    )}
                                </div>
                            ) : visibleRuns.map((run) => (
                                <AgentRunCard
                                    key={run.uuid}
                                    deploymentUuid={deploymentUuid}
                                    run={run}
                                    onSelectDeployment={onSelectDeployment}
                                />
                            ))}

                            {monitoring.redeployments.length > 0 && (
                                <div class="rounded-xl border border-primary/20 bg-primary/5 p-3 sm:p-4">
                                    <p class="mb-2 text-sm font-semibold text-primary sm:mb-3">Redéploiements</p>
                                    <ul class="grid gap-2">
                                        {monitoring.redeployments.map((deployment) => (
                                            <li key={deployment.uuid}>
                                                <button
                                                    class="flex w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-base-300/70 bg-base-100 px-3 py-2.5 text-left text-sm transition hover:border-primary/40"
                                                    type="button"
                                                    onClick={() => onSelectDeployment?.(deployment.uuid)}
                                                >
                                                    <span class="min-w-0 truncate">
                                                        {deployment.commit_message ?? 'Nouveau déploiement'}
                                                    </span>
                                                    <span class="flex shrink-0 items-center gap-2">
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

function CorrectionSummaryBlock({
    correction,
    deploymentUuid,
    onSelectDeployment,
}: {
    correction: DeploymentAgentCorrection;
    deploymentUuid: string;
    onSelectDeployment?: (deploymentUuid: string) => void;
}) {
    return (
        <div class="mb-3 grid gap-3 rounded-lg border border-base-300/60 bg-base-100 p-3">
            <div class="flex flex-wrap items-start justify-between gap-2">
                <div class="min-w-0">
                    <p class="text-xs font-semibold uppercase tracking-wide text-base-content/45">Résumé de correction</p>
                    <p class="mt-1 text-sm font-medium text-base-content">{correction.headline}</p>
                    {correction.diagnosis && correction.diagnosis !== correction.headline && (
                        <p class="mt-1 text-xs text-base-content/60">{correction.diagnosis}</p>
                    )}
                </div>
                <span class={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${outcomeToneClass(correction.outcome)}`}>
                    {outcomeLabel(correction.outcome)}
                </span>
            </div>

            {correction.pills.length > 0 && (
                <div class="flex flex-wrap gap-1.5">
                    {correction.pills.map((pill) => {
                        const inactive = !pill.active;
                        const className = inactive
                            ? 'border-base-300/50 bg-base-200/40 text-base-content/35'
                            : 'border-primary/25 bg-primary/10 text-primary';
                        const detail = shortSha(typeof pill.detail === 'string' ? pill.detail : null);
                        const href = pill.href
                            ? (pill.href.startsWith('/') ? routeHref(pill.href.replace(/^\/devforge/, '') || '/') : pill.href)
                            : null;
                        const isExternal = Boolean(href && /^https?:\/\//i.test(href));

                        if (pill.active && href) {
                            return (
                                <a
                                    key={pill.id}
                                    class={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium ${className}`}
                                    href={href}
                                    target={isExternal ? '_blank' : undefined}
                                    rel={isExternal ? 'noreferrer' : undefined}
                                >
                                    {pill.label}
                                    {detail && <span class="font-mono opacity-80">{detail}</span>}
                                    {isExternal && <ExternalLink class="size-3" aria-hidden />}
                                    {!isExternal && <ArrowRight class="size-3" aria-hidden />}
                                </a>
                            );
                        }

                        return (
                            <span
                                key={pill.id}
                                class={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium ${className}`}
                            >
                                {pill.label}
                                {pill.active && detail && <span class="font-mono opacity-80">{detail}</span>}
                            </span>
                        );
                    })}
                </div>
            )}

            {Array.isArray(correction.steps) && correction.steps.length > 0 && (
                <ol class="grid list-decimal gap-1.5 pl-4 text-xs text-base-content/75">
                    {correction.steps.map((step, index) => (
                        <li key={`step-${index}`}>{step}</li>
                    ))}
                </ol>
            )}

            {correction.actions.length > 0 && (
                <ul class="grid gap-1.5 text-xs text-base-content/70">
                    {correction.actions.map((action, index) => (
                        <li key={`${action.kind}-${index}`} class="flex flex-wrap items-center justify-between gap-2">
                            <span>
                                <span class="font-medium text-base-content">{action.label ?? action.kind}</span>
                                {action.detail && <span class="text-base-content/50"> · {action.detail}</span>}
                                {action.commit_sha && (
                                    <span class="ml-1 font-mono text-base-content/45">{shortSha(action.commit_sha)}</span>
                                )}
                            </span>
                            {action.kind === 'redeploy' && action.deployment_uuid && action.deployment_uuid !== deploymentUuid && (
                                <button
                                    class="btn btn-ghost btn-xs rounded-full"
                                    type="button"
                                    onClick={() => onSelectDeployment?.(action.deployment_uuid!)}
                                >
                                    <Rocket class="size-3" aria-hidden />
                                    Voir
                                </button>
                            )}
                            {action.pr_url && (
                                <a class="link link-primary text-[11px]" href={action.pr_url} target="_blank" rel="noreferrer">
                                    Ouvrir la PR
                                </a>
                            )}
                            {action.commit_url && !action.pr_url && (
                                <a class="link link-primary text-[11px]" href={action.commit_url} target="_blank" rel="noreferrer">
                                    Voir le commit
                                </a>
                            )}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

function AgentRunCard({ deploymentUuid, run, onSelectDeployment }: AgentRunCardProps) {
    const [logsOpen, setLogsOpen] = useState(false);
    const event = typeof run.event_context?.event === 'string' ? run.event_context.event : null;
    const agentDetailHref = run.agent
        ? routeHref(agentDetailPath(run.agent.uuid, { view: 'runs', run: run.uuid }))
        : null;
    const ephemeralTasks = Array.isArray(run.metadata?.ephemeral_tasks)
        ? run.metadata.ephemeral_tasks as Array<{ goal?: string; status?: string; model_label?: string }>
        : [];
    const activeLeafs = ephemeralTasks.filter((task) =>
        ['pending', 'running', 'queued'].includes(String(task.status ?? '')),
    ).length;
    const subagents = run.subagent_runs ?? [];
    const correction = run.correction ?? null;
    const otherAttemptUuid = correction?.belongs_to_deployment_uuid
        && correction.belongs_to_deployment_uuid !== deploymentUuid
        ? correction.belongs_to_deployment_uuid
        : (run.historical_for_other_attempt
            ? (typeof run.event_context?.deployment_uuid === 'string' ? run.event_context.deployment_uuid : null)
            : null);

    return (
        <article class="min-w-0 overflow-hidden rounded-xl border border-base-300/70 bg-base-200/20 p-3 sm:p-4">
            <div class="mb-3 flex items-start justify-between gap-2">
                <div class="flex min-w-0 items-start gap-2.5 overflow-hidden sm:gap-3">
                    {run.agent ? (
                        <AgentAvatar
                            type={run.agent.type}
                            color={run.agent.avatar_color}
                            name={run.agent.name}
                            size="sm"
                        />
                    ) : (
                        <div class="grid size-8 shrink-0 place-items-center rounded-xl bg-base-300 text-base-content/50">
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
                                    aria-label="Ouvrir le détail de l’exécution"
                                >
                                    <ExternalLink class="size-3" aria-hidden />
                                    <span class="hidden sm:inline">Détail</span>
                                </a>
                            )}
                        </div>
                        <p class="text-xs text-base-content/50">{eventLabel(event)}</p>
                        {otherAttemptUuid && (
                            <p class="mt-1 rounded-md border border-warning/25 bg-warning/5 px-2 py-1 text-[11px] text-warning">
                                Lié à un échec précédent
                            </p>
                        )}
                    </div>
                </div>
                <div class="shrink-0">
                    <AgentRunStatusBadge status={run.status} />
                </div>
            </div>

            {activeLeafs > 0 && (
                <p class="mb-3 rounded-md border border-info/25 bg-info/5 px-2 py-1.5 text-[11px] text-info">
                    {activeLeafs} sous-tâche{activeLeafs > 1 ? 's' : ''} leaf en cours
                </p>
            )}

            {correction ? (
                <CorrectionSummaryBlock
                    correction={correction}
                    deploymentUuid={deploymentUuid}
                    onSelectDeployment={onSelectDeployment}
                />
            ) : run.summary ? (
                <p class="mb-3 line-clamp-4 break-words text-sm text-base-content/70">
                    {run.summary}
                </p>
            ) : null}

            <dl class="mb-3 grid gap-1 text-xs text-base-content/55 sm:grid-cols-2">
                <div><dt class="inline">Démarré </dt><dd class="inline font-medium text-base-content">{formatDateTime(run.started_at ?? run.created_at)}</dd></div>
                {run.finished_at && (
                    <div><dt class="inline">Terminé </dt><dd class="inline font-medium text-base-content">{formatDateTime(run.finished_at)}</dd></div>
                )}
            </dl>

            {run.actions_taken.length > 0 && !correction?.actions?.length && (
                <div class="mb-3">
                    <p class="mb-2 text-xs font-semibold uppercase tracking-wide text-base-content/45">Actions</p>
                    <ul class="grid gap-2">
                        {run.actions_taken.map((action, index) => (
                            <li
                                class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-base-300/60 bg-base-100 px-3 py-2 text-xs"
                                key={`${action.at}-${index}`}
                            >
                                <span class="min-w-0">
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
                                        Voir
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
                                <span class="min-w-0 truncate">
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
                                <span class="font-medium">{task.model_label ?? 'Tâche'}</span>
                                {task.goal && <p class="mt-1 line-clamp-2 text-base-content/55">{task.goal}</p>}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {run.logs && (
                <div class="min-w-0 overflow-hidden rounded-lg border border-base-300/50">
                    <button
                        type="button"
                        class="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-xs font-medium text-base-content/65 hover:bg-base-200/50"
                        aria-expanded={logsOpen}
                        onClick={() => setLogsOpen((open) => !open)}
                    >
                        <span>Logs</span>
                        <ChevronDown class={`size-3.5 transition ${logsOpen ? 'rotate-180' : ''}`} aria-hidden />
                    </button>
                    {logsOpen && (
                        <div class="border-t border-base-300/50 p-2">
                            <AgentRunLog logs={run.logs} class="max-h-64 w-full max-w-full" />
                        </div>
                    )}
                </div>
            )}
        </article>
    );
}
