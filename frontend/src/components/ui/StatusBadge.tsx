type StatusBadgeProps = {
    label: string;
    tone?: 'success' | 'warning' | 'neutral' | 'error';
};

const toneClasses = {
    success: 'border-success/30 bg-success/10 text-success',
    warning: 'border-warning/30 bg-warning/10 text-warning',
    neutral: 'border-base-300 bg-base-200 text-base-content/60',
    error: 'border-error/30 bg-error/10 text-error',
};

export function StatusBadge({ label, tone = 'neutral' }: StatusBadgeProps) {
    return (
        <span class={`inline-flex h-5 items-center rounded-full border px-2 text-[11px] font-medium ${toneClasses[tone]}`}>
            {label}
        </span>
    );
}
