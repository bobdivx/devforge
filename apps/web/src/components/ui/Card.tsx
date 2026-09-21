import type { ComponentChildren } from 'preact';
import { cn } from '../../lib/cn';

type Props = {
  class?: string;
  children: ComponentChildren;
  padding?: 'none' | 'sm' | 'md' | 'lg';
};

const pads = {
  none: '',
  sm: 'p-3 sm:p-4',
  md: 'p-4 sm:p-5',
  lg: 'p-4 sm:p-6',
};

export function Card({ class: className, children, padding = 'md' }: Props) {
  return (
    <div
      class={cn(
        'min-w-0 overflow-x-hidden rounded-2xl border border-[var(--color-line)] bg-[var(--color-card)] transition-[border-color,box-shadow] duration-200',
        pads[padding],
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ComponentChildren;
}) {
  return (
    <div class="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div class="min-w-0 flex-1">
        <h2 class="text-sm font-medium tracking-tight text-[var(--color-ink)]">{title}</h2>
        {description && (
          <p class="mt-1 text-sm text-[var(--color-ink-muted)]">{description}</p>
        )}
      </div>
      {action && <div class="shrink-0">{action}</div>}
    </div>
  );
}
