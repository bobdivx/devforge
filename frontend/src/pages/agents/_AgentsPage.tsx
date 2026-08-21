import { MessageSquare, Plus, RefreshCw } from 'lucide-preact';
import { useState } from 'preact/hooks';
import { AgentCard } from '../../components/agents/AgentCard';
import { AgentUserRequestsInbox } from '../../components/agents/AgentUserRequestsInbox';
import { BotStudio } from '../../components/agents/BotStudio';
import { CreateAgentModal } from '../../components/agents/CreateAgentModal';
import { MissionBoardPanel } from '../../components/agents/MissionBoardPanel';
import { PageHeader } from '../../components/PageHeader';
import { DataState } from '../../components/ui/DataState';
import { domainApi } from '../../lib/domain-api';
import { agentDetailPath, resolveContinueChatAgent } from '../../lib/agent-routes';
import { routeHref } from '../../lib/routes';
import { useApiQuery } from '../../lib/use-api-query';
import { navigateTo, useNavigate } from '../../lib/use-navigate';
import { useTeamContext } from '../../lib/team-context';

type Props = {
    userName?: string;
};

export function AgentsPage({ userName = 'Vous' }: Props) {
    const onNavigate = useNavigate();
    const { agentsEnabled } = useTeamContext();
    const [createOpen, setCreateOpen] = useState(false);
    const query = useApiQuery(agentsEnabled ? 'agents' : null, () => domainApi.agents());
    const agents = query.data?.data ?? [];
    const isEmpty = agents.length === 0;
    const continueAgent = resolveContinueChatAgent(agents);
    const continuePath = continueAgent ? agentDetailPath(continueAgent.uuid) : null;
    const continueName = continueAgent
        ? (agents.find((agent) => agent.uuid === continueAgent.uuid)?.name ?? 'agent')
        : null;

    return (
        <div class="grid min-w-0 gap-5">
            {!(isEmpty && !query.loading && !query.error) && (
                <PageHeader
                    title="Agents IA"
                    description="Votre équipe de Bots autonomes qui surveille et améliore la plateforme."
                    actions={(
                        <>
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
                <div class="mb-0 flex flex-col gap-3 rounded-xl border border-primary/25 bg-primary/5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div class="min-w-0">
                        <p class="text-sm font-semibold">Continuer le chat</p>
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
                    <div class="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-3">
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
