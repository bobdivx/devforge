import { ChevronRight, Clock, Trash2, Zap } from 'lucide-preact';
import type { AgentRun } from '../../lib/domain-api';
import { AgentRunStatusBadge } from './AgentRunStatusBadge';
import { AgentModelRoutingBadge } from './AgentModelRoutingBadge';

const triggerLabels: Record<string, string> = {
    scheduled: 'Planifié',
    manual: 'Manuel',
    event: 'Webhook',
    chat: 'Chat',
    ephemeral: 'Sous-tâche',
    delegation: 'Délégation',
};

const triggerIcons: Record<string, string> = {
    scheduled: '⏱',
    manual: '▶',
    event: '⚡',
    chat: '💬',
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

function runTitle(run: AgentRun): string {
    const summary = run.summary?.trim();

    if (summary && summary.length <= 80) {
        return summary.replace(/^Erreur:\s*/i, '');
    }

    if (summary) {
        return `${summary.slice(0, 77)}…`;
    }

    const trigger = triggerLabels[run.trigger] ?? run.trigger;
    const date = new Date(run.created_at).toLocaleString('fr-FR', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
    });

    return `${trigger} · ${date}`;
}

type Props = {
    runs: AgentRun[];
    selectedUuid: string | null;
    onSelect: (uuid: string) => void;
    onDelete?: (uuid: string) => void;
};

export function RunHistoryTable({ runs, selectedUuid, onSelect, onDelete }: Props) {
    if (runs.length === 0) {
        return (
            <div class="flex flex-col items-center gap-2 sm:gap-3 px-6 py-10 text-center">
                <div class="grid size-12 place-items-center rounded-2xl bg-base-200 text-base-content/40">
                    <Zap class="size-6" aria-hidden />
                </div>
                <div>
                    <p class="text-xs sm:text-sm font-medium text-base-content/80">Aucune exécution pour l&apos;instant</p>
                    <p class="mt-1 text-xs text-base-content/50">
                        Les runs webhook et manuels apparaîtront ici avec leurs logs.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <ul class="space-y-2 p-2">
            {runs.map((run) => {
                const selected = selectedUuid === run.uuid;
                const isLive = run.status === 'running' || run.status === 'pending';

                return (
                    <li key={run.uuid} class="relative group/item">
                        <button
                            class={`group flex w-full items-start gap-3 rounded-xl border px-3 py-3 text-left transition-all ${
                                onDelete ? 'pe-9' : ''
                            } ${
                                selected
                                    ? 'border-primary/40 bg-primary/10 shadow-sm ring-1 ring-primary/20'
                                    : 'border-base-300/80 bg-base-100 hover:border-base-content/20 hover:bg-base-200/50'
                            }`}
                            type="button"
                            onClick={() => onSelect(run.uuid)}
                        >
                            <div class="mt-0.5 shrink-0">
                                <span class="flex size-9 items-center justify-center rounded-lg bg-base-200 text-base text-base-content/70 group-hover:bg-base-300/80">
                                    {triggerIcons[run.trigger] ?? '•'}
                                </span>
                            </div>
                            <div class="min-w-0 flex-1">
                                <div class="flex flex-wrap items-center gap-2">
                                    <AgentRunStatusBadge status={run.status} />
                                    {isLive && (
                                        <span class="badge badge-success badge-xs">Live</span>
                                    )}
                                </div>
                                <p class="mt-1.5 line-clamp-2 text-xs font-medium leading-snug text-base-content">
                                    {runTitle(run)}
                                </p>
                                <div class="mt-1.5 flex flex-wrap items-center gap-1.5">
                                    <AgentModelRoutingBadge routing={run.metadata?.model_routing} compact />
                                </div>
                                <p class="mt-1.5 flex flex-wrap items-center gap-1 text-[10px] text-base-content/50">
                                    <Clock class="size-3 shrink-0" aria-hidden />
                                    <span>{triggerLabels[run.trigger] ?? run.trigger}</span>
                                    <span aria-hidden>·</span>
                                    <span>
                                        {new Date(run.created_at).toLocaleString('fr-FR', {
                                             day: '2-digit',
                                             month: '2-digit',
                                             hour: '2-digit',
                                             minute: '2-digit',
                                        })}
                                    </span>
                                    <span aria-hidden>·</span>
                                    <span>{formatDuration(run.duration_seconds)}</span>
                                </p>
                            </div>
                            <ChevronRight class={`mt-2 size-4 shrink-0 ${selected ? 'text-primary' : 'text-base-content/30'}`} aria-hidden />
                        </button>
                        {onDelete && (
                            <button
                                type="button"
                                class="btn btn-ghost btn-xs absolute end-1.5 top-2.5 z-10 size-7 min-h-7 p-0 text-base-content/40 opacity-0 group-hover/item:opacity-100 hover:bg-error/15 hover:text-error transition focus:opacity-100"
                                title="Supprimer ce run"
                                aria-label={`Supprimer run ${run.uuid}`}
                                onClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    onDelete(run.uuid);
                                }}
                            >
                                <Trash2 class="size-3.5" aria-hidden />
                            </button>
                        )}
                    </li>
                );
            })}
        </ul>
    );
}
