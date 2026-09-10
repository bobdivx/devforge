import type { ComponentChildren } from 'preact';
import { cn } from '../../lib/cn';

export function Container({
  children,
  class: className,
}: {
  children: ComponentChildren;
  class?: string;
}) {
  return <div class={cn('mx-auto w-full max-w-6xl px-6', className)}>{children}</div>;
}

export function Section({
  children,
  class: className,
  id,
}: {
  children: ComponentChildren;
  class?: string;
  id?: string;
}) {
  return (
    <section id={id} class={cn('py-20 md:py-28', className)}>
      {children}
    </section>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ComponentChildren;
}) {
  return (
    <div class="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 class="text-3xl font-semibold tracking-tight text-[var(--color-ink)]">{title}</h1>
        {description && (
          <p class="mt-2 max-w-xl text-sm text-[var(--color-ink-muted)]">{description}</p>
        )}
      </div>
      {actions}
    </div>
  );
}

export function Separator({ class: className }: { class?: string }) {
  return <div class={cn('h-px w-full bg-[var(--color-line)]', className)} />;
}
