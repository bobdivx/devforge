import type { ComponentChildren } from 'preact';

type CardProps = {
    title?: string;
    eyebrow?: string;
    children: ComponentChildren;
    class?: string;
};

export function Card({ title, eyebrow, children, class: className = '' }: CardProps) {
    return (
        <section class={`min-w-0 rounded-2xl border border-base-300/70 bg-base-100 shadow-sm ${className}`}>
            <div class="grid gap-3 p-5">
                {(title || eyebrow) && (
                    <header class="grid gap-1">
                        {eyebrow && <p class="text-[11px] font-semibold uppercase tracking-widest text-base-content/45">{eyebrow}</p>}
                        {title && <h2 class="text-base font-semibold">{title}</h2>}
                    </header>
                )}
                {children}
            </div>
        </section>
    );
}
