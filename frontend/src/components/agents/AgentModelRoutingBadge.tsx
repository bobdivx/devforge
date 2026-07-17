import type { AgentModelRouting } from '../../lib/domain-api';

const tierStyles: Record<string, string> = {
    light: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20',
    standard: 'bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/20',
    heavy: 'bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/20',
};

type Props = {
    routing: AgentModelRouting | null | undefined;
    compact?: boolean;
    ephemeral?: boolean;
};

export function AgentModelRoutingBadge({ routing, compact = false, ephemeral = false }: Props) {
    if (!routing) {
        return null;
    }

    const tierClass = tierStyles[routing.tier] ?? tierStyles.standard;
    const label = ephemeral ? `Sous-tâche · ${routing.model_label}` : routing.display;

    return (
        <span
            class={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${tierClass}`}
            title={routing.reason}
        >
            {label}
            {!compact && routing.tier_label ? (
                <span class="opacity-70">({routing.tier_label})</span>
            ) : null}
        </span>
    );
}
