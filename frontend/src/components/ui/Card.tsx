import type { ComponentChildren } from 'preact';

type CardProps = {
    title?: string;
    eyebrow?: string;
    children: ComponentChildren;
    class?: string;
    actions?: ComponentChildren;
};

export function Card({ title, eyebrow, children, class: className = '', actions }: CardProps) {
    return (
        <section class={`devforge-card min-w-0 overflow-hidden rounded-[1.25rem] bg-base-100 ${className}`}>
            <div class="grid min-w-0 gap-2.5 sm:gap-3 md:gap-2.5 sm:gap-3 md:gap-4 overflow-hidden p-5 md:p-6">
                {(title || eyebrow || actions) && (
                    <header class="flex min-w-0 items-start justify-between gap-3">
                        <div class="grid min-w-0 gap-1">
                            {eyebrow && (
                                <p class="text-[11px] font-semibold uppercase tracking-[0.14em] text-base-content/40">
                                    {eyebrow}
                                </p>
                            )}
                            {title && <h2 class="text-sm sm:text-base font-semibold tracking-tight">{title}</h2>}
                        </div>
                        {actions}
                    </header>
                )}
                {children}
            </div>
        </section>
    );
}
