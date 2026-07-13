type ProgressBarProps = {
    value: number;
    max?: number;
    label?: string;
    tone?: 'primary' | 'success' | 'warning' | 'error';
};

const toneClasses = {
    primary: 'bg-primary',
    success: 'bg-success',
    warning: 'bg-warning',
    error: 'bg-error',
};

export function ProgressBar({ value, max = 100, label, tone = 'primary' }: ProgressBarProps) {
    const percent = Math.max(0, Math.min(100, Math.round((value / max) * 100)));

    return (
        <div class="grid gap-1">
            {(label || true) && (
                <div class="flex items-center justify-between text-[11px] text-base-content/55">
                    <span>{label ?? 'Progression'}</span>
                    <span class="tabular-nums">{percent}%</span>
                </div>
            )}
            <div class="h-2 overflow-hidden rounded-sm bg-base-300">
                <div class={`h-full transition-all ${toneClasses[tone]}`} style={{ width: `${percent}%` }} />
            </div>
        </div>
    );
}
