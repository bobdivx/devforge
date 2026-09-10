import type { ComponentChildren } from 'preact';
import { cn } from '../../lib/cn';

type Tone = 'neutral' | 'accent' | 'ok' | 'warn' | 'danger';

const tones: Record<Tone, string> = {
  neutral: 'border border-[var(--color-line)] bg-white/5 text-[var(--color-ink-muted)]',
  accent: 'border border-[var(--color-accent)]/30 bg-[var(--color-accent-soft)] text-[var(--color-accent)]',
  ok: 'border border-emerald-500/20 bg-emerald-500/10 text-[var(--color-ok)]',
  warn: 'border border-amber-500/20 bg-amber-500/10 text-[var(--color-warn)]',
  danger: 'border border-red-500/20 bg-red-500/10 text-[var(--color-danger)]',
};

export function Badge({
  children,
  tone = 'neutral',
  class: className,
  title,
}: {
  children: ComponentChildren;
  tone?: Tone;
  class?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      class={cn(
        'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
