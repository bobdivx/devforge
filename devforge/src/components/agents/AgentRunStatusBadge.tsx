import { Bot, CheckCircle2, Loader2, XCircle } from 'lucide-preact';
import type { AgentRunStatus } from '../../lib/domain-api';

const config: Record<AgentRunStatus, { label: string; classes: string; Icon: typeof Bot; spin?: boolean }> = {
    pending: { label: 'En attente', classes: 'border-base-300 bg-base-200 text-base-content/60', Icon: Bot },
    running: { label: 'En cours', classes: 'border-success/30 bg-success/10 text-success', Icon: Loader2, spin: true },
    completed: { label: 'Terminé', classes: 'border-success/30 bg-success/10 text-success', Icon: CheckCircle2 },
    failed: { label: 'Échoué', classes: 'border-error/30 bg-error/10 text-error', Icon: XCircle },
};

type Props = {
    status: AgentRunStatus;
};

export function AgentRunStatusBadge({ status }: Props) {
    const { label, classes, Icon, spin } = config[status] ?? config.pending;

    return (
        <span
            class={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${classes}`}
            title={label}
            aria-label={label}
        >
            <Icon class={`size-3.5 ${spin ? 'animate-spin' : ''}`} aria-hidden />
            <span>{label}</span>
        </span>
    );
}
