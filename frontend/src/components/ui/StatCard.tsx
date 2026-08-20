import type { LucideIcon } from 'lucide-preact';
import { Card } from './Card';

type StatCardProps = {
    label: string;
    value: string | number;
    hint?: string;
    tone?: 'default' | 'success' | 'warning' | 'error';
    href?: string;
    icon?: LucideIcon;
    onNavigate?: (event: MouseEvent, path: string) => void;
};

const toneClasses = {
    default: 'text-base-content',
    success: 'text-success',
    warning: 'text-warning',
    error: 'text-error',
};

export function StatCard({ label, value, hint, tone = 'default', href, icon: Icon, onNavigate }: StatCardProps) {
    const content = (
        <div class="grid min-w-0 gap-3">
            <div class="flex items-start justify-between gap-3">
                <p class="text-[11px] font-semibold uppercase tracking-[0.14em] text-base-content/45">{label}</p>
                {Icon && (
                    <span class="grid size-8 place-items-center rounded-xl bg-base-200 text-base-content/50">
                        <Icon class="size-4" aria-hidden />
                    </span>
                )}
            </div>
            <p class={`text-[1.75rem] font-semibold leading-none tracking-tight tabular-nums ${toneClasses[tone]}`}>
                {value}
            </p>
            {hint && <p class="truncate text-xs text-base-content/50">{hint}</p>}
        </div>
    );

    if (href && onNavigate) {
        return (
            <Card class="min-w-0 transition hover:ring-1 hover:ring-primary/25">
                <a class="grid min-w-0 gap-1 outline-none focus-visible:ring-2 focus-visible:ring-primary" href={href} onClick={(event) => onNavigate(event, href)}>
                    {content}
                </a>
            </Card>
        );
    }

    return (
        <Card class="min-w-0">
            {content}
        </Card>
    );
}
