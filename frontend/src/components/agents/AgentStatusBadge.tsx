import { Bot, Loader2, Pause, XCircle } from 'lucide-preact';
import type { AgentStatus } from '../../lib/domain-api';

type Props = {
    status: AgentStatus;
    spinning?: boolean;
};

const config: Record<AgentStatus, { label: string; classes: string; Icon: typeof Bot }> = {
    idle: { label: 'Prêt', classes: 'border-base-300 bg-base-200 text-base-content/60', Icon: Bot },
    running: { label: 'En cours', classes: 'border-success/30 bg-success/10 text-success', Icon: Loader2 },
    error: { label: 'Erreur', classes: 'border-error/30 bg-error/10 text-error', Icon: XCircle },
    paused: { label: 'Suspendu', classes: 'border-warning/30 bg-warning/10 text-warning', Icon: Pause },
};

export function AgentStatusBadge({ status, spinning = false }: Props) {
    const { label, classes, Icon } = config[status] ?? config.idle;

    return (
        <span
            class={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${classes}`}
            title={label}
            aria-label={label}
        >
            <Icon class={`size-3.5 ${spinning ? 'animate-spin' : ''}`} aria-hidden />
            <span>{label}</span>
        </span>
    );
}
