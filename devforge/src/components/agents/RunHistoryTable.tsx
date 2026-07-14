import { ChevronRight } from 'lucide-preact';
import type { AgentRun } from '../../lib/domain-api';
import { AgentStatusBadge } from './AgentStatusBadge';
import { AgentModelRoutingBadge } from './AgentModelRoutingBadge';

const triggerLabels: Record<string, string> = {
    scheduled: 'Planifié',
    manual: 'Manuel',
    event: 'Événement',
    chat: 'Chat',
    ephemeral: 'Sous-tâche',
    delegation: 'Délégation',
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

type Props = {
    runs: AgentRun[];
    selectedUuid: string | null;
    onSelect: (uuid: string) => void;
};

export function RunHistoryTable({ runs, selectedUuid, onSelect }: Props) {
    if (runs.length === 0) {
        return <p class="py-4 text-center text-xs text-base-content/50">Aucune exécution enregistrée.</p>;
    }

    return (
        <ul class="divide-y divide-base-300">
            {runs.map((run) => (
                <li key={run.uuid}>
                    <button
                        class={`flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-base-200 ${selectedUuid === run.uuid ? 'bg-base-200' : ''}`}
                        type="button"
                        onClick={() => onSelect(run.uuid)}
                    >
                        <AgentStatusBadge status={run.status as 'idle' | 'running' | 'error' | 'paused'} />
                        <div class="min-w-0 flex-1">
                            <p class="truncate text-xs font-medium">
                                {run.summary ?? 'Exécution en cours…'}
                            </p>
                            <div class="mt-1 flex flex-wrap items-center gap-1.5">
                                <AgentModelRoutingBadge routing={run.metadata?.model_routing} compact />
                            </div>
                            <p class="text-[11px] text-base-content/50">
                                {triggerLabels[run.trigger] ?? run.trigger}
                                {' · '}
                                {new Date(run.created_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                                {' · '}
                                {formatDuration(run.duration_seconds)}
                                {run.tokens_used > 0 && ` · ${run.tokens_used} tokens`}
                            </p>
                        </div>
                        <ChevronRight class="size-3.5 shrink-0 text-base-content/40" aria-hidden />
                    </button>
                </li>
            ))}
        </ul>
    );
}
