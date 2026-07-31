import { Bot, Plus, RefreshCw } from 'lucide-preact';
import { useState } from 'preact/hooks';
import { AgentCard } from '../../components/agents/AgentCard';
import { AiProvidersSettings } from '../../components/agents/AiProvidersSettings';
import { CreateAgentModal } from '../../components/agents/CreateAgentModal';
import { LayeredInstructionsPanel } from '../../components/agents/LayeredInstructionsPanel';
import { MissionBoardPanel } from '../../components/agents/MissionBoardPanel';
import { PageHeader } from '../../components/PageHeader';
import { OllamaControlPanel } from '../../components/settings/OllamaControlPanel';
import { Card } from '../../components/ui/Card';
import { DataState } from '../../components/ui/DataState';
import type { BootstrapPermissions } from '../../lib/bootstrap';
import { domainApi } from '../../lib/domain-api';
import { useApiQuery } from '../../lib/use-api-query';
import { useNavigate } from '../../lib/use-navigate';
import { useTeamContext } from '../../lib/team-context';

export function AgentsPage({
    permissions,
}: {
    permissions: BootstrapPermissions;
}) {
    const onNavigate = useNavigate();
    const { agentsEnabled } = useTeamContext();
    const [createOpen, setCreateOpen] = useState(false);
    const query = useApiQuery(agentsEnabled ? 'agents' : null, () => domainApi.agents());
    const agents = query.data?.data ?? [];
    const isEmpty = agents.length === 0;
    const canManageAi = permissions.manage_team || permissions.instance_admin;

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
                    <div class="mb-5 flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-base-300 p-12 text-center">
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
                    <div class="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
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

            <div class="grid gap-4">
                <Card title="Intelligence Artificielle" eyebrow="Providers LLM">
                    <AiProvidersSettings />
                </Card>
                <Card title="Ollama" eyebrow="Modèles locaux · GPU">
                    <OllamaControlPanel canManage={canManageAi} />
                </Card>
                <Card title="Instructions agents" eyebrow="Couches org / perso / projet">
                    <LayeredInstructionsPanel />
                </Card>
            </div>

            <CreateAgentModal
                open={createOpen}
                onClose={() => setCreateOpen(false)}
                onCreated={() => void query.reload()}
            />
        </>
    );
}
