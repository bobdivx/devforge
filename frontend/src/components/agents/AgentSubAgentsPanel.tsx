import { Plus, Users } from 'lucide-preact';
import { useState } from 'preact/hooks';
import type { Agent } from '../../lib/domain-api';
import { agentDetailPath } from '../../lib/agent-routes';
import { routeHref } from '../../lib/routes';
import { navigateTo } from '../../lib/use-navigate';
import { AgentAvatar } from './AgentAvatar';
import { CreateAgentModal } from './CreateAgentModal';
import { AgentStatusBadge } from './AgentStatusBadge';

type Props = {
    agent: Agent;
    onUpdated: () => void;
};

export function AgentSubAgentsPanel({ agent, onUpdated }: Props) {
    const [createOpen, setCreateOpen] = useState(false);
    const children = agent.sub_agents ?? [];
    const canAddChildren = !agent.parent_agent_id && Boolean(agent.id);

    return (
        <section class="grid gap-3 rounded-xl border border-base-300 p-3">
            <div class="flex items-start justify-between gap-3">
                <div>
                    <h3 class="flex items-center gap-1.5 text-xs font-semibold">
                        <Users class="size-3.5 text-base-content/50" aria-hidden />
                        Sous-agents
                    </h3>
                    <p class="mt-1 text-[11px] text-base-content/55">
                        Spécialistes permanents pour la délégation. Les tâches éphémères sont créées automatiquement pendant les missions.
                    </p>
                </div>
                {canAddChildren && (
                    <button class="btn btn-ghost btn-xs gap-1" type="button" onClick={() => setCreateOpen(true)}>
                        <Plus class="size-3" aria-hidden />
                        Ajouter
                    </button>
                )}
            </div>

            {agent.parent_agent_id ? (
                <p class="text-[11px] text-base-content/55">
                    Cet agent est déjà un sous-agent : pas de niveau supplémentaire.
                </p>
            ) : children.length === 0 ? (
                <p class="rounded-md border border-dashed border-base-300 px-3 py-4 text-center text-[11px] text-base-content/50">
                    Aucun spécialiste permanent pour l’instant.
                </p>
            ) : (
                <ul class="grid gap-2">
                    {children.map((child) => (
                        <li key={child.uuid}>
                            <a
                                class="flex items-center gap-3 rounded-lg border border-base-300 px-3 py-2 transition hover:border-primary/30 hover:bg-primary/5"
                                href={routeHref(agentDetailPath(child.uuid))}
                                onClick={(e) => {
                                    e.preventDefault();
                                    navigateTo(agentDetailPath(child.uuid));
                                }}
                            >
                                <AgentAvatar type={child.type} color={child.avatar_color} name={child.name} size="sm" />
                                <span class="min-w-0 flex-1">
                                    <span class="block truncate text-xs font-medium">{child.name}</span>
                                    <span class="block text-[10px] text-base-content/50">{child.type}</span>
                                </span>
                                <AgentStatusBadge status={child.status} />
                            </a>
                        </li>
                    ))}
                </ul>
            )}

            {canAddChildren && (
                <CreateAgentModal
                    open={createOpen}
                    parentAgent={agent}
                    onClose={() => setCreateOpen(false)}
                    onCreated={() => {
                        onUpdated();
                    }}
                />
            )}
        </section>
    );
}
