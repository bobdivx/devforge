import { MessageSquare, Plus, RefreshCw, RotateCcw, Trash2, Users, Zap } from 'lucide-preact';
import { useState } from 'preact/hooks';
import { AgentCard } from '../../components/agents/AgentCard';
import { AgentUserRequestsInbox } from '../../components/agents/AgentUserRequestsInbox';
import { BotStudio } from '../../components/agents/BotStudio';
import { CreateAgentModal } from '../../components/agents/CreateAgentModal';
import { MissionBoardPanel } from '../../components/agents/MissionBoardPanel';
import { DeployGraftButton } from '../../components/agents/DeployGraftButton';
import { TeamAgentRunsTable } from '../../components/agents/TeamAgentRunsTable';
import { PageHeader } from '../../components/PageHeader';
import { DataState } from '../../components/ui/DataState';
import { domainApi } from '../../lib/domain-api';
import { agentDetailPath, resolveContinueChatAgent } from '../../lib/agent-routes';
import { routeHref } from '../../lib/routes';
import { useApiQuery } from '../../lib/use-api-query';
import { navigateTo, useNavigate } from '../../lib/use-navigate';
import { useTeamContext } from '../../lib/team-context';
import { ApiError } from '../../lib/api-client';

type Props = {
    userName?: string;
};

type Tab = 'runs' | 'team' | 'board';

export function AgentsPage({ userName = 'Vous' }: Props) {
    const onNavigate = useNavigate();
    const { agentsEnabled } = useTeamContext();
    const [createOpen, setCreateOpen] = useState(false);
    const [resetting, setResetting] = useState(false);
    const [deletingAll, setDeletingAll] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<Tab>('runs');

    const query = useApiQuery(agentsEnabled ? 'agents' : null, () => domainApi.agents());
    const runsQuery = useApiQuery(agentsEnabled && activeTab === 'runs' ? 'team-agent-runs' : null, () => domainApi.teamAgentRuns());
    const agents = query.data?.data ?? [];
    const runs = runsQuery.data?.data ?? [];
    const isEmpty = agents.length === 0;
    const continueAgent = resolveContinueChatAgent(agents);
    const continuePath = continueAgent ? agentDetailPath(continueAgent.uuid) : null;
    const continueName = continueAgent
        ? (agents.find((agent) => agent.uuid === continueAgent.uuid)?.name ?? 'agent')
        : null;

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
            await query.reload();
        } catch (err) {
            setError(err instanceof ApiError ? err.message : 'Suppression totale impossible.');
        } finally {
            setDeletingAll(false);
        }
    };

    return (
        <div class="grid min-w-0 gap-3 sm:gap-4 md:gap-5">
            {error && <p class="text-xs text-error">{error}</p>}
            {!(isEmpty && !query.loading && !query.error) && (
                <PageHeader
                    title="Équipe IA"
                    description="Votre équipe de bots autonomes : travaux en cours, membres, et tâches planifiées."
                    actions={(
                        <>
                            <DeployGraftButton />
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
                                <span class="hidden sm:inline">Réinitialiser</span>
                            </button>
                            {agents.length > 0 && (
                                <button
                                    class="btn btn-ghost btn-sm border border-base-300/80 text-error/80 hover:text-error gap-1.5"
                                    type="button"
                                    disabled={deletingAll}
                                    title="Supprimer tous les agents"
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
                            <button class="btn btn-ghost btn-sm" type="button" onClick={() => void query.reload()}>
                                <RefreshCw class="size-3.5" aria-hidden />
                                Actualiser
                            </button>
                            <button class="btn btn-primary btn-sm" type="button" onClick={() => setCreateOpen(true)}>
                                <Plus class="size-3.5" aria-hidden />
                                Nouveau Bot
                            </button>
                        </>
                    )}
                />
            )}

            {continuePath && continueName && (
                <div class="mb-0 flex flex-col gap-2 sm:gap-3 rounded-xl border border-primary/25 bg-primary/5 px-2.5 sm:px-3 md:px-3 sm:px-4 py-2.5 sm:py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div class="min-w-0">
                        <p class="text-xs sm:text-sm font-semibold">Continuer le chat</p>
                        <p class="truncate text-xs text-base-content/60">
                            {continueAgent?.is_primary_chat ? 'Chat principal · ' : 'Dernier ouvert · '}
                            {continueName}
                        </p>
                    </div>
                    <a
                        class="btn btn-primary btn-sm gap-1.5 shrink-0"
                        href={routeHref(continuePath)}
                        onClick={(e) => onNavigate(e, continuePath)}
                    >
                        <MessageSquare class="size-3.5" aria-hidden />
                        Ouvrir le chat
                    </a>
                </div>
            )}

            {!isEmpty && <AgentUserRequestsInbox />}

            {!isEmpty && (
                <div class="min-w-0">
                    <div class="tabs tabs-boxed mb-3 sm:mb-4">
                        <button
                            type="button"
                            class={`tab gap-1.5 ${activeTab === 'runs' ? 'tab-active' : ''}`}
                            onClick={() => setActiveTab('runs')}
                        >
                            <Zap class="size-3.5" aria-hidden />
                            Activité
                        </button>
                        <button
                            type="button"
                            class={`tab gap-1.5 ${activeTab === 'team' ? 'tab-active' : ''}`}
                            onClick={() => setActiveTab('team')}
                        >
                            <Users class="size-3.5" aria-hidden />
                            Membres
                        </button>
                    </div>

                    {activeTab === 'runs' && (
                        <div class="min-w-0 rounded-xl border border-base-300 bg-base-100">
                            <TeamAgentRunsTable runs={runs} loading={runsQuery.loading} />
                        </div>
                    )}

                    {activeTab === 'team' && (
                        <DataState
                            loading={query.loading}
                            error={query.error}
                            onRetry={() => void query.reload()}
                        >
                            <div class="grid min-w-0 gap-2.5 sm:gap-3 md:gap-4 sm:grid-cols-2 xl:grid-cols-3">
                                {agents.map((agent) => (
                                    <AgentCard
                                        key={agent.uuid}
                                        agent={agent}
                                        onNavigate={onNavigate}
                                        onRefresh={() => void query.reload({ silent: true })}
                                    />
                                ))}
                            </div>
                        </DataState>
                    )}

                    <MissionBoardPanel />
                </div>
            )}

            <DataState
                loading={query.loading}
                error={query.error}
                onRetry={() => void query.reload()}
            >
                {isEmpty && !query.loading ? (
                    <BotStudio
                        open
                        variant="page"
                        userName={userName}
                        onClose={() => {}}
                        onCreated={(agent) => {
                            if (agent?.uuid) {
                                navigateTo(agentDetailPath(agent.uuid));
                                return;
                            }
                            void query.reload();
                        }}
                    />
                ) : (
                    <div class="grid min-w-0 gap-2.5 sm:gap-3 md:gap-4 sm:grid-cols-2 xl:grid-cols-3">
                        {agents.map((agent) => (
                            <AgentCard
                                key={agent.uuid}
                                agent={agent}
                                onNavigate={onNavigate}
                                onRefresh={() => void query.reload({ silent: true })}
                            />
                        ))}
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
                        navigateTo(agentDetailPath(agent.uuid));
                        return;
                    }
                    void query.reload();
                }}
            />
        </div>
    );
}
