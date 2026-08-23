import type { ComponentChildren } from 'preact';
import { ArrowUpRight } from 'lucide-preact';
import { ResourceStatusIcon } from './ResourceStatusIcon';

type ResourceCardProps = {
    title: string;
    subtitle: string;
    status: string | {
        reachable: boolean;
        usable: boolean;
        validating: boolean;
    };
    logo?: ComponentChildren;
    selected?: boolean;
    class?: string;
    style?: { animationDelay?: string };
    onClick: () => void;
};

export function ResourceCard({
    title,
    subtitle,
    status,
    logo,
    selected = false,
    class: className = '',
    style,
    onClick,
}: ResourceCardProps) {
    return (
        <button
            class={`devforge-card group grid min-w-0 gap-4 p-5 text-left transition hover:ring-1 hover:ring-primary/20 focus-visible:ring-2 focus-visible:ring-primary ${
                selected ? 'ring-1 ring-primary/30' : ''
            } ${className}`}
            type="button"
            style={style}
            onClick={onClick}
        >
            <div class="flex items-start justify-between gap-3">
                <div class="flex min-w-0 items-start gap-3">
                    {logo}
                    <div class="min-w-0">
                        <p class="truncate text-xs sm:text-sm font-semibold tracking-tight">{title}</p>
                        <p class="truncate text-xs text-base-content/45">{subtitle}</p>
                    </div>
                </div>
                <ResourceStatusIcon status={status} />
            </div>
            <span class="inline-flex items-center gap-1 text-xs font-medium text-primary/80 transition group-hover:text-primary">
                Ouvrir
                <ArrowUpRight class="size-3.5" aria-hidden />
            </span>
        </button>
    );
}
