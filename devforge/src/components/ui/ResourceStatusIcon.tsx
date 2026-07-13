import { parseResourceStatus, type ResourceStatusTone } from '../../lib/resource-status';

type ResourceStatusIconProps = {
    status: string | {
        reachable: boolean;
        usable: boolean;
        validating: boolean;
    };
    size?: 'sm' | 'md';
    showLabel?: boolean;
    class?: string;
};

const toneClasses: Record<ResourceStatusTone, string> = {
    success: 'border-success/30 bg-success/10 text-success',
    warning: 'border-warning/30 bg-warning/10 text-warning',
    error: 'border-error/30 bg-error/10 text-error',
    neutral: 'border-base-300/80 bg-base-200/70 text-base-content/55',
};

const sizeClasses = {
    sm: 'size-3.5',
    md: 'size-4',
};

export function ResourceStatusIcon({
    status,
    size = 'sm',
    showLabel = false,
    class: className = '',
}: ResourceStatusIconProps) {
    const parsed = parseResourceStatus(status);
    const Icon = parsed.Icon;

    return (
        <span
            class={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-1 ${toneClasses[parsed.tone]} ${className}`}
            title={parsed.label}
            aria-label={parsed.label}
        >
            <Icon class={`${sizeClasses[size]} ${parsed.spin ? 'animate-spin' : ''}`} aria-hidden />
            {showLabel && <span class="text-[11px] font-medium">{parsed.shortLabel}</span>}
        </span>
    );
}
