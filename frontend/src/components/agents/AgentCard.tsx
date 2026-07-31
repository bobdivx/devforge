import { CheckCircle2, Play, Settings2, Pause, RefreshCw, Zap } from 'lucide-preact';
import { useEffect, useState } from 'preact/hooks';
import type { Agent } from '../../lib/domain-api';
import { domainApi } from '../../lib/domain-api';
import { routeHref } from '../../lib/routes';
import { scheduleLabel } from '../../lib/agent-triggers';
import { isInFlightAgentRunStatus, shouldTrackAgentLatestRun } from '../../lib/agent-run-tracker';
import { ActionToolbar } from '../ui/ActionToolbar';
import { AgentAvatar } from './AgentAvatar';
import { AgentErrorAlert } from './AgentErrorAlert';
import { AgentStatusBadge } from './AgentStatusBadge';
import { AgentRunProgress } from './AgentRunProgress';
import { agentDetailPath } from '../../lib/agent-routes';
import { formatAgentProviderDisplay } from '../../lib/llm-models';
import { useAgentRunTracker } from '../../lib/use-agent-run-tracker';

const typeLabels: Record<string, string> = {
    debug: 'Débogage',
    'tech-watch': 'Veille Tech',
    github: 'GitHub',
    'github-actions': 'GitHub Actions',
    devforge: 'DevForge',
    deployment: 'Déploiement',
    security: 'Sécurité',
};

function relativeTime(isoDate: string | null): string {
    if (!isoDate) {
        return 'Jamais';
    }
    const diff = Date.now() - new Date(isoDate).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) {
        return "À l'instant";
    }
    if (minutes < 60) {
        return `Il y a ${minutes} min`;
    }
    const hours = Math.floor(minutes / 60);
    if (hours < 24) {
        return `Il y a ${hours} h`;
    }
    return `Il y a ${Math.floor(hours / 24)} j`;
}

type Props = {
    agent: Agent;
    onNavigate: (event: MouseEvent, path: string) => void;
    onRefresh: () => void;
};

export function AgentCard({ agent, onNavigate, onRefresh }: Props) {
    const [toggling, setToggling] = useState(false);
    const {
        isLaunching,
        isTracking,
        activeRun,
        runError,
        outcome,
        launch,
        trackExistingRun,
    } = useAgentRunTracker(agent.uuid, { onComplete: onRefresh });

    useEffect(() => {
        if (shouldTrackAgentLatestRun(agent.status, agent.latest_run, isTracking)) {
            trackExistingRun(agent.latest_run!.uuid);
        }
    }, [agent.status, agent.latest_run?.uuid, agent.latest_run?.status, isTracking, trackExistingRun]);

    const detailPath = agentDetailPath(agent.uuid);
    const settingsPath = agentDetailPath(agent.uuid, { settings: true });
    const runsPath = agentDetailPath(agent.uuid, {
        view: 'runs',
        run: activeRun?.uuid ?? agent.latest_run?.uuid ?? null,
    });
    const latestRunInFlight = Boolean(
        agent.latest_run && isInFlightAgentRunStatus(agent.latest_run.status),
    );
    // is_active = permanently enabled; status/running = one execution only.
    const isBusy = isTracking || (agent.status === 'running' && latestRunInFlight);
    const displayStatus = !agent.is_active
        ? 'paused'
        : isBusy
            ? 'running'
            : agent.status === 'running' && !latestRunInFlight
                ? 'idle'
                : agent.status;
    const showProgress = isTracking && activeRun && (activeRun.status === 'running' || activeRun.status === 'pending' || activeRun.status === 'waiting_for_subagents');
    const showSuccess = outcome === 'completed' && !isTracking;
    const displayError = runError ?? (outcome === 'failed' && activeRun?.summary ? activeRun.summary : null);

    const handleRun = async (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (isBusy) {
            return;
        }
        await launch();
    };

    const handleToggleActive = async (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setToggling(true);
        try {
            await domainApi.updateAgent(agent.uuid, {
                is_active: !agent.is_active,
                status: agent.is_active ? 'paused' : 'idle',
            });
            onRefresh();
        } catch {
            // ignore
        } finally {
            setToggling(false);
        }
    };

    return (
        <article
            class="card border border-base-300 bg-base-100 transition-shadow hover:shadow-md cursor-pointer"
            onClick={(e) => {
                const target = e.target as HTMLElement;
                if (target.closest('button, a')) {
                    return;
                }
                onNavigate(e as unknown as MouseEvent, detailPath);
            }}
        >
            <div class="card-body gap-4 p-4">
                <div class="flex items-start gap-3">
                    <AgentAvatar type={agent.type} color={agent.avatar_color} name={agent.name} />
                    <div class="min-w-0 flex-1">
                        <div class="flex items-center gap-2">
                            <a
                                class="truncate text-sm font-semibold hover:underline"
                                href={routeHref(detailPath)}
                                onClick={(e) => onNavigate(e as unknown as MouseEvent, detailPath)}
                            >
                                {agent.name}
                            </a>
                            {agent.sub_agents_count > 0 && (
                                <span class="badge badge-xs border-base-300 bg-base-200 text-base-content/50">
                                    +{agent.sub_agents_count}
                                </span>
                            )}
                        </div>
                        <p class="text-[11px] text-base-content/50">
                            {typeLabels[agent.type] ?? agent.type}
                            {agent.provider && (
                                <span class="ml-1 before:me-1 before:content-['·']">{formatAgentProviderDisplay(agent.provider.provider, activeRun?.metadata?.model_routing ?? agent.latest_run?.metadata?.model_routing)}</span>
                            )}
                        </p>
                    </div>
                    <div class="flex flex-col items-end gap-1">
                        <AgentStatusBadge status={displayStatus} spinning={isLaunching || displayStatus === 'running'} />
                        {agent.is_active && displayStatus !== 'paused' && (
                            <span class="text-[10px] font-medium text-success/80">Activé</span>
                        )}
                    </div>
                </div>

                {agent.description && (
                    <p class="line-clamp-2 text-xs text-base-content/65">{agent.description}</p>
                )}

                {showProgress && (
                    <>
                        <AgentRunProgress run={activeRun} compact />
                        <a
                            class="btn btn-ghost btn-xs h-auto min-h-0 gap-1.5 self-start px-0 text-[11px] text-primary hover:bg-transparent"
                            href={routeHref(runsPath)}
                            onClick={(e) => onNavigate(e as unknown as MouseEvent, runsPath)}
                        >
                            <Zap class="size-3" aria-hidden />
                            Voir l&apos;exécution en direct
                        </a>
                    </>
                )}

                {showSuccess && (
                    <p class="flex items-center gap-1.5 rounded-md border border-success/30 bg-success/10 px-2 py-1.5 text-[11px] text-success" role="status">
                        <CheckCircle2 class="size-3.5 shrink-0" aria-hidden />
                        <span class="truncate">{activeRun?.summary?.trim() || 'Exécution terminée avec succès.'}</span>
                    </p>
                )}

                {!showSuccess && !displayError && <AgentErrorAlert agent={agent} compact onNavigate={onNavigate} />}

                {displayError && (
                    <>
                        <p class="rounded-md border border-error/30 bg-error/10 px-2 py-1.5 text-[11px] text-error" role="alert">
                            {displayError}
                        </p>
                        <a
                            class="btn btn-ghost btn-xs h-auto min-h-0 gap-1.5 self-start px-0 text-[11px] text-error hover:bg-transparent"
                            href={routeHref(runsPath)}
                            onClick={(e) => onNavigate(e as unknown as MouseEvent, runsPath)}
                        >
                            <Zap class="size-3" aria-hidden />
                            Voir les logs
                        </a>
                    </>
                )}

                <div class="flex flex-col gap-3 border-t border-base-300 pt-3 sm:flex-row sm:items-center sm:justify-between">
                    <div class="text-[11px] text-base-content/50">
                        {scheduleLabel(agent)}
                        <span class="ms-2 before:me-1 before:content-['·']">
                            {relativeTime(agent.last_run_at)}
                        </span>
                    </div>
                    <ActionToolbar>
                        <button
                            class="btn btn-ghost btn-xs gap-1"
                            type="button"
                            title={agent.is_active ? "Suspendre l'agent (reste configuré, ne s'exécute plus)" : "Activer l'agent (éligible au planning / lancement)"}
                            disabled={toggling || isBusy}
                            onClick={handleToggleActive}
                        >
                            {toggling
                                ? <RefreshCw class="size-3 animate-spin" aria-hidden />
                                : agent.is_active
                                    ? <Pause class="size-3" aria-hidden />
                                    : <Play class="size-3" aria-hidden />}
                        </button>
                        <button
                            class={`btn btn-xs gap-1 ${isBusy ? 'btn-primary pointer-events-none' : 'btn-primary'}`}
                            type="button"
                            title={isBusy ? 'Exécution en cours…' : 'Lancer maintenant'}
                            disabled={isBusy || !agent.is_active || !agent.provider}
                            onClick={handleRun}
                            aria-busy={isLaunching}
                        >
                            {isLaunching ? (
                                <>
                                    <span class="loading loading-spinner loading-xs" aria-hidden />
                                    Démarrage…
                                </>
                            ) : isBusy ? (
                                <>En cours</>
                            ) : (
                                <>
                                    <Play class="size-3" aria-hidden />
                                    Lancer
                                </>
                            )}
                        </button>
                        <a
                            class="btn btn-ghost btn-xs"
                            href={routeHref(settingsPath)}
                            title="Configurer"
                            onClick={(e) => onNavigate(e as unknown as MouseEvent, settingsPath)}
                        >
                            <Settings2 class="size-3" aria-hidden />
                        </a>
                    </ActionToolbar>
                </div>
            </div>
        </article>
    );
}
