import type { ComponentChildren } from 'preact';

type EmptyStateProps = {
    title: string;
    description?: string;
    icon?: ComponentChildren;
    action?: ComponentChildren;
};

export function EmptyState({ title, description, icon, action }: EmptyStateProps) {
    return (
        <div class="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-base-300 bg-base-100 p-10 text-center">
            {icon && <div class="grid size-12 place-items-center rounded-xl bg-primary/10 text-primary">{icon}</div>}
            <div>
                <h3 class="text-sm font-semibold">{title}</h3>
                {description && <p class="mt-1 text-xs text-base-content/60">{description}</p>}
            </div>
            {action}
        </div>
    );
}
