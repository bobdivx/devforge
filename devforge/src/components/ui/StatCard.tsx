import { Card } from './Card';

type StatCardProps = {
    label: string;
    value: string | number;
    hint?: string;
    tone?: 'default' | 'success' | 'warning' | 'error';
    href?: string;
    onNavigate?: (event: MouseEvent, path: string) => void;
};

const toneClasses = {
    default: 'text-base-content',
    success: 'text-success',
    warning: 'text-warning',
    error: 'text-error',
};

export function StatCard({ label, value, hint, tone = 'default', href, onNavigate }: StatCardProps) {
    const content = (
        <>
            <p class="text-[11px] font-medium uppercase tracking-wider text-base-content/50">{label}</p>
            <p class={`text-2xl font-semibold tabular-nums ${toneClasses[tone]}`}>{value}</p>
            {hint && <p class="truncate text-xs text-base-content/55">{hint}</p>}
        </>
    );

    if (href && onNavigate) {
        return (
            <Card class="min-w-0 transition hover:border-primary/40">
                <a class="grid min-w-0 gap-1 outline-none focus-visible:ring-2 focus-visible:ring-primary" href={href} onClick={(event) => onNavigate(event, href)}>
                    {content}
                </a>
            </Card>
        );
    }

    return (
        <Card class="min-w-0">
            <div class="grid min-w-0 gap-1">{content}</div>
        </Card>
    );
}
