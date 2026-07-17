import { Bot, CheckCircle2, Loader2, ShieldAlert, XCircle } from 'lucide-preact';
import type { AgentRunStatus } from '../../lib/domain-api';

const config: Record<AgentRunStatus, { label: string; classes: string; Icon: typeof Bot }> = {
    pending: { label: 'En attente', classes: 'border-base-300 bg-base-200 text-base-content/60', Icon: Bot },
    running: { label: 'En cours', classes: 'border-success/30 bg-success/10 text-success', Icon: Loader2 },
    completed: { label: 'Terminé', classes: 'border-success/30 bg-success/10 text-success', Icon: CheckCircle2 },
    awaiting_approval: { label: 'Approbation', classes: 'border-warning/30 bg-warning/10 text-warning', Icon: ShieldAlert },
    failed: { label: 'Échoué', classes: 'border-error/30 bg-error/10 text-error', Icon: XCircle },
};

type Props = {
    status: AgentRunStatus;
};

export function AgentRunStatusBadge({ status }: Props) {
    const { label, classes, Icon } = config[status] ?? config.pending;

    return (
        <span
            class={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${classes}`}
            title={label}
            aria-label={label}
        >
            <Icon class="size-3.5" aria-hidden />
            <span>{label}</span>
        </span>
    );
}
