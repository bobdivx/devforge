import type { ComponentChildren } from 'preact';
import { ActionToolbar } from './ui/ActionToolbar';

type PageHeaderProps = {
    title: string;
    description: string;
    eyebrow?: string;
    actions?: ComponentChildren;
};

export function PageHeader({ title, description, eyebrow, actions }: PageHeaderProps) {
    return (
        <header class="mb-2 flex min-w-0 flex-col justify-between gap-2.5 sm:gap-3 md:gap-4 sm:flex-row sm:items-end">
            <div class="grid min-w-0 gap-2">
                {eyebrow && <p class="text-[11px] font-semibold uppercase tracking-widest text-base-content/40">{eyebrow}</p>}
                <h1 class="text-[1.75rem] font-semibold tracking-tight sm:text-3xl">{title}</h1>
                <p class="max-w-2xl text-sm text-base-content/50">{description}</p>
            </div>
            {actions && <ActionToolbar class="w-full sm:w-auto">{actions}</ActionToolbar>}
        </header>
    );
}
