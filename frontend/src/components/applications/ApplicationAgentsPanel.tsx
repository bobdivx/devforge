import {
    Bot,
    CheckCircle2,
    MessageSquare,
    Pause,
    Play,
    Plus,
    RefreshCw,
    RotateCcw,
    Sparkles,
    Trash2,
    X,
    Zap,
} from 'lucide-preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { Agent, CoreResource } from '../../lib/domain-api';
import { domainApi } from '../../lib/domain-api';
import { ApiError } from '../../lib/api-client';
import { useApiQuery } from '../../lib/use-api-query';
import { useTeamContext } from '../../lib/team-context';
import { AgentAvatar } from '../agents/AgentAvatar';
import { AgentStatusBadge } from '../agents/AgentStatusBadge';
import { AgentErrorAlert } from '../agents/AgentErrorAlert';
import { AgentRunProgress } from '../agents/AgentRunProgress';
import { AgentRunsView } from '../agents/AgentRunsView';
import { AgentConversationView } from '../agents/AgentConversationView';
import { CreateAgentModal } from '../agents/CreateAgentModal';
import { DataState } from '../ui/DataState';
import { formatAgentProviderDisplay } from '../../lib/llm-models';
import { scheduleLabel } from '../../lib/agent-triggers';
import { useAgentRunTracker } from '../../lib/use-agent-run-tracker';
import { isInFlightAgentRunStatus, shouldTrackAgentLatestRun } from '../../lib/agent-run-tracker';
import { agentDetailSessionUuid } from '../../lib/agent-routes';
import { pickApplicationChatAgent } from '../../lib/application-agent-chat';

const typeLabels: Record<string, string> = {
    debug: 'Débogage',
    'tech-watch': 'Veille Tech',
    github: 'GitHub',
    'github-actions': 'GitHub Actions',
    devforge: 'DevForge',
    deployment: 'Déploiement',
    worker: 'Worker',
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

type AgentCardItemProps = {
    agent: Agent;
    application: CoreResource;
    isSelected: boolean;
    onSelectChat: (agent: Agent) => void;
    onRefresh: () => void;
    onDelete: (agent: Agent) => void;
};

function ApplicationAgentCardItem({
    agent,
    application,
    isSelected,
    onSelectChat,
    onRefresh,
    onDelete,
}: AgentCardItemProps) {
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

    const isDedicated = agent.resource_uuid === application.uuid;
    const latestRunInFlight = Boolean(
        agent.latest_run && isInFlightAgentRunStatus(agent.latest_run.status),
    );
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
            class={`card border bg-base-100 transition-all ${
                isSelected
                    ? 'border-primary ring-2 ring-primary/20 shadow-md'
                    : 'border-base-300/80 hover:border-primary/40 hover:shadow-sm'
            }`}
        >
            <div class="card-body gap-2.5 p-3.5 sm:p-4">
                <div class="flex items-start gap-2.5 sm:gap-3">
                    <AgentAvatar
                        type={agent.type}
                        color={agent.avatar_color}
                        shape={agent.avatar_shape}
                        name={agent.name}
                        status={displayStatus}
                    />
                    <div class="min-w-0 flex-1">
                        <div class="flex flex-wrap items-center gap-1.5">
                            <span class="truncate text-xs sm:text-sm font-semibold">{agent.name}</span>
                            {isDedicated && (
                                <span class="badge badge-primary badge-xs font-normal">Dédié app</span>
                            )}
                            {agent.is_primary_chat && (
                                <span class="badge badge-ghost badge-xs text-primary">Chat principal</span>
                            )}
                            {agent.sub_agents_count > 0 && (
                                <span class="badge badge-ghost badge-xs text-base-content/50">
                                    +{agent.sub_agents_count} sous-agents
                                </span>
                            )}
                        </div>
                        <p class="mt-0.5 truncate text-[11px] text-base-content/50">
                            {typeLabels[agent.type] ?? agent.type}
                            {agent.provider && (
                                <span class="ml-1 before:me-1 before:content-['·']">
                                    {formatAgentProviderDisplay(agent.provider.provider, activeRun?.metadata?.model_routing ?? agent.latest_run?.metadata?.model_routing)}
                                </span>
                            )}
                        </p>
                    </div>
                    <div class="flex shrink-0 flex-col items-end gap-1">
                        <AgentStatusBadge status={displayStatus} spinning={isLaunching || displayStatus === 'running'} />
                    </div>
                </div>

                {agent.description && (
                    <p class="line-clamp-2 text-[11px] sm:text-xs text-base-content/65 leading-relaxed">
                        {agent.description}
                    </p>
                )}

                {showProgress && <AgentRunProgress run={activeRun} compact />}

                {showSuccess && (
                    <p class="flex items-center gap-1.5 rounded-md border border-success/30 bg-success/10 px-2 py-1 text-[10px] sm:text-[11px] text-success" role="status">
                        <CheckCircle2 class="size-3 shrink-0" aria-hidden />
                        <span class="truncate">{activeRun?.summary?.trim() || 'Exécution terminée.'}</span>
                    </p>
                )}

                {!showSuccess && !displayError && <AgentErrorAlert agent={agent} compact />}

                {displayError && (
                    <p class="rounded-md border border-error/30 bg-error/10 px-2 py-1 text-[10px] sm:text-[11px] text-error" role="alert">
                        {displayError}
                    </p>
                )}

                <div class="flex flex-wrap items-center justify-between gap-2 border-t border-base-300/60 pt-2.5">
                    <span class="text-[10px] text-base-content/45">
                        {scheduleLabel(agent)} · {relativeTime(agent.last_run_at)}
                    </span>
                    <div class="flex flex-wrap items-center gap-1">
                        <button
                            class={`btn btn-xs gap-1 ${isSelected ? 'btn-primary' : 'btn-ghost border border-base-300/70'}`}
                            type="button"
                            title="Ouvrir le chat avec cet agent"
                            onClick={() => onSelectChat(agent)}
                        >
                            <MessageSquare class="size-3" aria-hidden />
                            <span>{isSelected ? 'Chat actif' : 'Chat'}</span>
                        </button>
                        <button
                            class="btn btn-ghost btn-xs btn-square size-7 min-h-7"
                            type="button"
                            title={agent.is_active ? 'Suspendre l’agent' : 'Activer l’agent'}
                            disabled={toggling || isBusy}
                            onClick={handleToggleActive}
                        >
                            {toggling ? (
                                <RefreshCw class="size-3 animate-spin" aria-hidden />
                            ) : agent.is_active ? (
                                <Pause class="size-3" aria-hidden />
                            ) : (
                                <Play class="size-3" aria-hidden />
                            )}
                        </button>
                        <button
                            class={`btn btn-xs gap-1 ${isBusy ? 'btn-primary pointer-events-none' : 'btn-ghost border border-base-300/70'}`}
                            type="button"
                            title="Lancer immédiatement"
                            disabled={isBusy || !agent.is_active || !agent.provider}
                            onClick={handleRun}
                        >
                            {isLaunching ? (
                                <span class="loading loading-spinner loading-xs" aria-hidden />
                            ) : (
                                <Play class="size-3" aria-hidden />
                            )}
                            <span>{isBusy ? 'En cours' : 'Lancer'}</span>
                        </button>
                        <button
                            class="btn btn-ghost btn-xs btn-square size-7 min-h-7 text-error/70 hover:text-error"
                            type="button"
                            title="Supprimer cet agent"
                            onClick={() => onDelete(agent)}
                        >
                            <Trash2 class="size-3" aria-hidden />
                        </button>
                    </div>
                </div>
            </div>
        </article>
    );
}

type Props = {
    application: CoreResource;
    userName?: string;
};

export function ApplicationAgentsPanel({ application, userName = 'Vous' }: Props) {
    const { agentsEnabled } = useTeamContext();
    const [createOpen, setCreateOpen] = useState(false);
    const [selectedAgentUuid, setSelectedAgentUuid] = useState<string | null>(() => (
        typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('agent')
    ));
    const [focusedSessionUuid, setFocusedSessionUuid] = useState<string | null>(() => (
        typeof window === 'undefined' ? null : agentDetailSessionUuid(window.location.search)
    ));
    const [activeSubTab, setActiveSubTab] = useState<'chat' | 'runs'>('chat');
    const [resetting, setResetting] = useState(false);
    const [deletingAll, setDeletingAll] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const query = useApiQuery(agentsEnabled ? 'application-agents' : null, () => domainApi.agents());
    const allAgents = query.data?.data ?? [];

    /** Agents utilisables sur cette app : équipe (sans verrou) + dédiés à cette app. */
    const usableAgents = useMemo(
        () => allAgents.filter((a) => !a.resource_uuid || a.resource_uuid === application.uuid),
        [allAgents, application.uuid],
    );
    const dedicatedAgents = useMemo(
        () => usableAgents.filter((a) => a.resource_uuid === application.uuid),
        [usableAgents, application.uuid],
    );
    const teamAgents = useMemo(
        () => usableAgents.filter((a) => !a.resource_uuid),
        [usableAgents],
    );

    // Initialiser l'agent sélectionné par défaut (URL agent=…, sinon agent chat de l’app)
    useEffect(() => {
        if (usableAgents.length === 0) {
            return;
        }

        if (selectedAgentUuid && usableAgents.some((agent) => agent.uuid === selectedAgentUuid)) {
            return;
        }

        const fromUrl = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('agent');
        if (fromUrl && usableAgents.some((agent) => agent.uuid === fromUrl)) {
            setSelectedAgentUuid(fromUrl);
            return;
        }

        const preferred = pickApplicationChatAgent(usableAgents, application.uuid)
            ?? dedicatedAgents[0]
            ?? teamAgents.find((a) => ['worker', 'deployment', 'devforge'].includes(a.type))
            ?? usableAgents[0];
        if (preferred) {
            setSelectedAgentUuid(preferred.uuid);
        }
    }, [usableAgents, dedicatedAgents, teamAgents, selectedAgentUuid, application.uuid]);

    useEffect(() => {
        if (!selectedAgentUuid || typeof window === 'undefined') {
            return;
        }

        const params = new URLSearchParams(window.location.search);
        if (params.get('new') !== '1') {
            return;
        }

        let cancelled = false;

        void domainApi.createAgentSession(selectedAgentUuid)
            .then((created) => {
                if (cancelled) {
                    return;
                }

                setFocusedSessionUuid(created.data.uuid);
                params.delete('new');
                params.set('session', created.data.uuid);
                params.set('agent', selectedAgentUuid);
                params.set('tab', 'agents');
                window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);
            })
            .catch(() => {});

        return () => {
            cancelled = true;
        };
    }, [selectedAgentUuid]);

    const selectedAgent = useMemo(
        () => usableAgents.find((a) => a.uuid === selectedAgentUuid) ?? null,
        [usableAgents, selectedAgentUuid],
    );

    const handleDeleteAgent = async (agent: Agent) => {
        if (!window.confirm(`Supprimer définitivement l'agent « ${agent.name} » ?`)) {
            return;
        }
        setError(null);
        try {
            await domainApi.deleteAgent(agent.uuid);
            if (selectedAgentUuid === agent.uuid) {
                setSelectedAgentUuid(null);
            }
            await query.reload({ silent: true });
        } catch (err) {
            setError(err instanceof ApiError ? err.message : 'Suppression impossible.');
        }
    };

    const handleResetTeam = async () => {
        if (!window.confirm(
            'Réinitialiser toute l’équipe d’agents ?\n'
            + 'Cela recréera une équipe propre avec les 3 agents par défaut : Relanceur, Veille et Worker.',
        )) {
            return;
        }
        setResetting(true);
        setError(null);
        try {
            await domainApi.resetAgents();
            await query.reload();
        } catch (err) {
            setError(err instanceof ApiError ? err.message : 'Réinitialisation impossible.');
        } finally {
            setResetting(false);
        }
    };

    const handleDeleteAll = async () => {
        if (!window.confirm('Supprimer TOUS les agents de l’équipe ? Cette action est irréversible.')) {
            return;
        }
        setDeletingAll(true);
        setError(null);
        try {
            await domainApi.deleteAllAgents();
            setSelectedAgentUuid(null);
            await query.reload();
        } catch (err) {
            setError(err instanceof ApiError ? err.message : 'Suppression totale impossible.');
        } finally {
            setDeletingAll(false);
        }
    };

    if (!agentsEnabled) {
        return (
            <div class="rounded-xl border border-base-300 bg-base-100 p-6 text-center">
                <Bot class="mx-auto size-8 text-base-content/40" />
                <h3 class="mt-2 text-sm font-semibold">Agents IA désactivés</h3>
                <p class="mt-1 text-xs text-base-content/60">Activez les agents dans les paramètres de l'instance.</p>
            </div>
        );
    }

    return (
        <section class="grid min-w-0 gap-3 sm:gap-4">
            {/* Header Toolbar */}
            <div class="flex flex-col gap-3 rounded-xl border border-base-300/80 bg-base-100 p-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4 sm:p-4">
                <div class="min-w-0 flex-1">
                    <h3 class="flex flex-wrap items-center gap-2 text-xs sm:text-sm font-semibold">
                        <Bot class="size-4 shrink-0 text-primary" aria-hidden />
                        <span>Agents IA</span>
                        <span class="badge badge-ghost badge-sm tabular-nums">
                            {usableAgents.length} {usableAgents.length > 1 ? 'agents' : 'agent'}
                        </span>
                    </h3>
                    <p class="mt-1 hidden text-xs text-base-content/55 sm:block sm:max-w-xl">
                        Un agent par type de travail (déploiement, veille…). Les sous-agents naissent pour une tâche ;
                        le contexte application est injecté au chat.
                    </p>
                </div>
                <div class="flex w-full shrink-0 flex-wrap items-center gap-1.5 sm:w-auto sm:justify-end">
                    <button
                        class="btn btn-primary btn-sm gap-1.5"
                        type="button"
                        onClick={() => setCreateOpen(true)}
                    >
                        <Plus class="size-3.5" aria-hidden />
                        <span class="sm:hidden">Nouveau</span>
                        <span class="hidden sm:inline">Nouveau Bot</span>
                    </button>
                    <button
                        class="btn btn-ghost btn-sm border border-base-300/80 gap-1.5"
                        type="button"
                        disabled={resetting}
                        title="Nettoie et recrée l'équipe propre par défaut (Relanceur, Veille, Worker)"
                        onClick={() => void handleResetTeam()}
                    >
                        {resetting ? (
                            <span class="loading loading-spinner loading-xs" aria-hidden />
                        ) : (
                            <RotateCcw class="size-3.5" aria-hidden />
                        )}
                        <span class="hidden sm:inline">Réinitialiser l'équipe</span>
                    </button>
                    {usableAgents.length > 0 && (
                        <button
                            class="btn btn-ghost btn-sm border border-base-300/80 text-error/80 hover:text-error gap-1.5"
                            type="button"
                            disabled={deletingAll}
                            title="Supprimer tous les agents de l'équipe"
                            onClick={() => void handleDeleteAll()}
                        >
                            {deletingAll ? (
                                <span class="loading loading-spinner loading-xs" aria-hidden />
                            ) : (
                                <Trash2 class="size-3.5" aria-hidden />
                            )}
                            <span class="hidden md:inline">Tout supprimer</span>
                        </button>
                    )}
                    <button
                        class="btn btn-ghost btn-sm btn-square size-8 min-h-8"
                        type="button"
                        title="Actualiser les agents"
                        onClick={() => void query.reload()}
                    >
                        <RefreshCw class="size-3.5" aria-hidden />
                    </button>
                </div>
            </div>

            {error && <p class="text-xs text-error">{error}</p>}
            {query.error && <p class="text-xs text-error">{query.error}</p>}

            <DataState loading={query.loading} error={query.error} onRetry={() => void query.reload()}>
                {usableAgents.length === 0 ? (
                    <div class="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-base-300 bg-base-100/50 p-8 sm:p-12 text-center">
                        <div class="grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary">
                            <Sparkles class="size-6" aria-hidden />
                        </div>
                        <div>
                            <h4 class="text-sm font-semibold">Aucun agent configuré</h4>
                            <p class="mt-1 max-w-sm text-xs text-base-content/60">
                                Créez un bot dédié pour cette application ou générez automatiquement l’équipe d’agents par défaut.
                            </p>
                        </div>
                        <div class="flex flex-wrap gap-2">
                            <button class="btn btn-primary btn-sm gap-1.5" type="button" onClick={() => setCreateOpen(true)}>
                                <Plus class="size-3.5" aria-hidden />
                                Créer un Bot
                            </button>
                            <button
                                class="btn btn-ghost btn-sm border border-base-300 gap-1.5"
                                type="button"
                                disabled={resetting}
                                onClick={() => void handleResetTeam()}
                            >
                                <RotateCcw class="size-3.5" aria-hidden />
                                Générer l'équipe par défaut
                            </button>
                        </div>
                    </div>
                ) : (
                    <div class="grid gap-3 sm:gap-4">
                        {/* Espace Chat & Exécution intégré pour l'agent sélectionné */}
                        {selectedAgent && (
                            <div class="overflow-hidden rounded-xl border border-base-300 bg-base-100 shadow-sm">
                                <div class="flex flex-wrap items-center justify-between gap-2 border-b border-base-300/80 bg-base-200/40 px-3 sm:px-4 py-2 sm:py-2.5">
                                    <div class="flex items-center gap-2 min-w-0">
                                        <AgentAvatar
                                            type={selectedAgent.type}
                                            color={selectedAgent.avatar_color}
                                            shape={selectedAgent.avatar_shape}
                                            name={selectedAgent.name}
                                            status={selectedAgent.status}
                                            size="sm"
                                        />
                                        <div class="min-w-0">
                                            <span class="text-xs sm:text-sm font-semibold truncate block">
                                                {selectedAgent.name}
                                            </span>
                                            <span class="text-[10px] text-base-content/50 truncate block">
                                                {typeLabels[selectedAgent.type] ?? selectedAgent.type} · {selectedAgent.provider ? selectedAgent.provider.model : 'Auto'}
                                            </span>
                                        </div>
                                    </div>
                                    <div class="flex items-center gap-1.5">
                                        <div class="join bg-base-100 border border-base-300/80 p-0.5 rounded-lg">
                                            <button
                                                class={`join-item btn btn-xs h-6 min-h-6 border-0 ${activeSubTab === 'chat' ? 'btn-primary' : 'btn-ghost'}`}
                                                type="button"
                                                onClick={() => setActiveSubTab('chat')}
                                            >
                                                <MessageSquare class="size-3" aria-hidden />
                                                Chat
                                            </button>
                                            <button
                                                class={`join-item btn btn-xs h-6 min-h-6 border-0 ${activeSubTab === 'runs' ? 'btn-primary' : 'btn-ghost'}`}
                                                type="button"
                                                onClick={() => setActiveSubTab('runs')}
                                            >
                                                <Zap class="size-3" aria-hidden />
                                                Exécutions & Logs
                                            </button>
                                        </div>
                                        <button
                                            class="btn btn-ghost btn-xs btn-square size-6 min-h-6"
                                            type="button"
                                            title="Fermer l'espace actif"
                                            onClick={() => setSelectedAgentUuid(null)}
                                        >
                                            <X class="size-3.5" aria-hidden />
                                        </button>
                                    </div>
                                </div>

                                <div class="flex h-[min(46rem,78dvh)] min-h-[24rem] sm:min-h-[30rem] flex-col min-h-0">
                                    {activeSubTab === 'chat' ? (
                                        <AgentConversationView
                                            agent={selectedAgent}
                                            initialSessionUuid={focusedSessionUuid}
                                            applicationUuid={application.uuid}
                                            userName={userName}
                                            onAgentUpdated={() => void query.reload({ silent: true })}
                                        />
                                    ) : (
                                        <AgentRunsView
                                            agent={selectedAgent}
                                            onAgentUpdated={() => void query.reload({ silent: true })}
                                        />
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Grille des cartes d'agents — secondaire au chat */}
                        <details class="grid gap-2.5 sm:gap-3" open>
                            <summary class="cursor-pointer text-xs font-semibold uppercase tracking-wider text-base-content/50">
                                Vos Cartes d'Agents ({usableAgents.length})
                            </summary>
                            <div class="grid gap-2.5 sm:gap-3 md:grid-cols-2 xl:grid-cols-3">
                                {usableAgents.map((agent) => (
                                    <ApplicationAgentCardItem
                                        key={agent.uuid}
                                        agent={agent}
                                        application={application}
                                        isSelected={selectedAgentUuid === agent.uuid}
                                        onSelectChat={(a) => {
                                            setSelectedAgentUuid(a.uuid);
                                            setActiveSubTab('chat');
                                        }}
                                        onRefresh={() => void query.reload({ silent: true })}
                                        onDelete={(a) => void handleDeleteAgent(a)}
                                    />
                                ))}
                            </div>
                        </details>
                    </div>
                )}
            </DataState>

            <CreateAgentModal
                open={createOpen}
                userName={userName}
                onClose={() => setCreateOpen(false)}
                onCreated={(agent) => {
                    setCreateOpen(false);
                    if (agent?.uuid) {
                        setSelectedAgentUuid(agent.uuid);
                    }
                    void query.reload();
                }}
            />
        </section>
    );
}
