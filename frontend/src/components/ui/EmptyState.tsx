import type { ComponentChildren } from 'preact';

type EmptyStateProps = {
    title: string;
    description?: string;
    icon?: ComponentChildren;
    action?: ComponentChildren;
};

export function EmptyState({ title, description, icon, action }: EmptyStateProps) {
    return (
        <div class="devforge-card flex flex-col items-center justify-center gap-2 sm:gap-3 px-6 py-12 text-center">
            {icon && <div class="grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary">{icon}</div>}
            <div>
                <h3 class="text-xs sm:text-sm font-semibold tracking-tight">{title}</h3>
                {description && <p class="mt-1 text-xs text-base-content/55">{description}</p>}
            </div>
            {action}
        </div>
    );
}
