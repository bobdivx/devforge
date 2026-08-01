import { Bot, Plus, RefreshCw } from 'lucide-preact';
import { useState } from 'preact/hooks';
import { AgentCard } from '../../components/agents/AgentCard';
import { CreateAgentModal } from '../../components/agents/CreateAgentModal';
import { MissionBoardPanel } from '../../components/agents/MissionBoardPanel';
import { PageHeader } from '../../components/PageHeader';
import { DataState } from '../../components/ui/DataState';
import { domainApi } from '../../lib/domain-api';
import { useApiQuery } from '../../lib/use-api-query';
import { useNavigate } from '../../lib/use-navigate';
import { useTeamContext } from '../../lib/team-context';

export function AgentsPage() {
    const onNavigate = useNavigate();
    const { agentsEnabled } = useTeamContext();
    const [createOpen, setCreateOpen] = useState(false);
    const query = useApiQuery(agentsEnabled ? 'agents' : null, () => domainApi.agents());
    const agents = query.data?.data ?? [];
    const isEmpty = agents.length === 0;

    return (
        <>
            <PageHeader
                title="Agents IA"
                description="Votre équipe d'agents autonomes qui surveille et améliore la plateforme."
                actions={(
                    <>
                        <button class="btn btn-ghost btn-sm" type="button" onClick={() => void query.reload()}>
                            <RefreshCw class="size-3.5" aria-hidden />
                            Actualiser
                        </button>
                        <button class="btn btn-primary btn-sm" type="button" onClick={() => setCreateOpen(true)}>
                            <Plus class="size-3.5" aria-hidden />
                            Nouvel agent
                        </button>
                    </>
                )}
            />

            <div class="mb-5">
                <MissionBoardPanel />
            </div>

            <DataState
                loading={query.loading}
                error={query.error}
                onRetry={() => void query.reload()}
            >
                {isEmpty && !query.loading ? (
                    <div class="flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-base-300 p-12 text-center">
                        <div class="grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary">
                            <Bot class="size-7" aria-hidden />
                        </div>
                        <div>
                            <h3 class="text-sm font-semibold">Pas encore d&apos;agents</h3>
                            <p class="mt-1 max-w-sm text-xs text-base-content/60">
                                Choisissez un rôle (CI, déploiement, veille…) — le déclenchement événementiel ou planifié est préconfiguré.
                            </p>
                        </div>
                        <button class="btn btn-primary btn-sm" type="button" onClick={() => setCreateOpen(true)}>
                            <Plus class="size-3.5" aria-hidden />
                            Créer un agent
                        </button>
                    </div>
                ) : (
                    <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
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
                onClose={() => setCreateOpen(false)}
                onCreated={() => void query.reload()}
            />
        </>
    );
}
