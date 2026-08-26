import { Activity, Bot, ChevronRight, Clock, Layers, Zap } from 'lucide-preact';
import type { AgentRunWithAgent } from '../../lib/domain-api';
import { AgentRunStatusBadge } from './AgentRunStatusBadge';
import { AgentAvatar } from './AgentAvatar';
import { routeHref, agentDetailPath } from '../../lib/routes';
import { useNavigate } from '../../lib/use-navigate';

const triggerLabels: Record<string, string> = {
    scheduled: 'Planifié',
    manual: 'Manuel',
    event: 'Événement',
    chat: 'Chat',
    chat_continue: 'Chat continu',
    ephemeral: 'Sous-tâche',
    delegation: 'Délégation',
};

const triggerIcons: Record<string, typeof Activity> = {
    scheduled: Clock,
    manual: Zap,
    event: Activity,
    chat: Bot,
    chat_continue: Bot,
};

function formatDuration(seconds: number | null): string {
    if (seconds === null) {
        return '—';
    }
    if (seconds < 60) {
        return `${seconds}s`;
    }
    return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function runSummary(run: AgentRunWithAgent): string {
    const summary = run.summary?.trim();
    if (summary && summary.length <= 100) {
        return summary.replace(/^Erreur:\s*/i, '');
    }
    if (summary) {
        return `${summary.slice(0, 97)}…`;
    }
    return triggerLabels[run.trigger] ?? run.trigger;
}

function getResourceInfo(run: AgentRunWithAgent): { type: string; name: string } | null {
    const meta = run.metadata;
    if (!meta) {
        return null;
    }

    if (meta.application_name) {
        return { type: 'App', name: meta.application_name };
    }

    if (meta.deployment_uuid) {
        return { type: 'Déploiement', name: meta.deployment_uuid.substring(0, 8) };
    }

    return null;
}

type Props = {
    runs: AgentRunWithAgent[];
    loading?: boolean;
};

export function TeamAgentRunsTable({ runs, loading = false }: Props) {
    const onNavigate = useNavigate();

    if (loading) {
        return (
            <div class="flex flex-col items-center gap-2 sm:gap-3 px-6 py-10 text-center">
                <span class="loading loading-spinner loading-md" />
                <p class="text-xs text-base-content/50">Chargement des exécutions…</p>
            </div>
        );
    }

    if (runs.length === 0) {
        return (
            <div class="flex flex-col items-center gap-2 sm:gap-3 px-6 py-10 text-center">
                <div class="grid size-12 place-items-center rounded-2xl bg-base-200 text-base-content/40">
                    <Zap class="size-6" aria-hidden />
                </div>
                <div>
                    <p class="text-xs sm:text-sm font-medium text-base-content/80">Aucune activité pour l'instant</p>
                    <p class="mt-1 text-xs text-base-content/50">
                        Les exécutions d'agents apparaîtront ici.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div class="overflow-x-auto">
            <table class="table table-sm">
                <thead>
                    <tr>
                        <th class="w-8" />
                        <th>Agent</th>
                        <th>Activité</th>
                        <th class="hidden md:table-cell">Ressource</th>
                        <th class="hidden lg:table-cell">Déclencheur</th>
                        <th>Statut</th>
                        <th class="text-right">Créé</th>
                        <th class="w-4" />
                    </tr>
                </thead>
                <tbody>
                    {runs.map((run) => {
                        const resource = getResourceInfo(run);
                        const TriggerIcon = triggerIcons[run.trigger] ?? Activity;
                        const agentStatus = run.status === 'failed' ? 'error' : run.status === 'completed' ? 'idle' : 'running';
                        const agentPath = run.agent ? agentDetailPath(run.agent.uuid) : null;

                        return (
                            <tr key={run.uuid} class="hover">
                                <td>
                                    {run.agent && (
                                        <AgentAvatar
                                            type={run.agent.type}
                                            color={run.agent.avatar_color}
                                            shape={run.agent.avatar_shape}
                                            name={run.agent.name}
                                            size="xs"
                                            status={agentStatus}
                                            animate={run.status === 'running' || run.status === 'pending'}
                                        />
                                    )}
                                </td>
                                <td>
                                    {agentPath ? (
                                        <a
                                            class="link link-hover font-medium truncate max-w-[12rem]"
                                            href={routeHref(agentPath)}
                                            onClick={(e) => onNavigate(e, agentPath)}
                                        >
                                            {run.agent?.name ?? '—'}
                                        </a>
                                    ) : (
                                        <span class="font-medium truncate max-w-[12rem]">{run.agent?.name ?? '—'}</span>
                                    )}
                                </td>
                                <td>
                                    <p class="truncate max-w-xs text-xs">{runSummary(run)}</p>
                                </td>
                                <td class="hidden md:table-cell">
                                    {resource ? (
                                        <div class="flex items-center gap-1.5 text-xs">
                                            <Layers class="size-3 text-base-content/40" aria-hidden />
                                            <span class="text-base-content/60">{resource.type}</span>
                                            <span class="font-medium">{resource.name}</span>
                                        </div>
                                    ) : (
                                        <span class="text-xs text-base-content/40">—</span>
                                    )}
                                </td>
                                <td class="hidden lg:table-cell">
                                    <div class="flex items-center gap-1.5 text-xs">
                                        <TriggerIcon class="size-3 text-base-content/40" aria-hidden />
                                        <span>{triggerLabels[run.trigger] ?? run.trigger}</span>
                                    </div>
                                </td>
                                <td>
                                    <AgentRunStatusBadge status={run.status} />
                                </td>
                                <td class="text-right whitespace-nowrap text-xs text-base-content/55">
                                    {new Date(run.created_at).toLocaleString('fr-FR', {
                                        day: '2-digit',
                                        month: '2-digit',
                                        hour: '2-digit',
                                        minute: '2-digit',
                                    })}
                                </td>
                                <td>
                                    {agentPath && (
                                        <a
                                            href={routeHref(agentPath)}
                                            onClick={(e) => onNavigate(e, agentPath)}
                                            class="btn btn-ghost btn-xs"
                                            aria-label={`Voir l'agent ${run.agent?.name ?? ''}`}
                                        >
                                            <ChevronRight class="size-3" aria-hidden />
                                        </a>
                                    )}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}
