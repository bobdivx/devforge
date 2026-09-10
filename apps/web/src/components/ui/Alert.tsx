import type { ComponentChildren } from 'preact';
import { cn } from '../../lib/cn';

type Tone = 'info' | 'warn' | 'danger' | 'ok';

const tones: Record<Tone, string> = {
  info: 'border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-ink-muted)]',
  warn: 'border-amber-500/25 bg-amber-500/10 text-amber-100',
  danger: 'border-red-500/25 bg-red-500/10 text-red-100',
  ok: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-100',
};

export function Alert({
  children,
  tone = 'info',
  class: className,
}: {
  children: ComponentChildren;
  tone?: Tone;
  class?: string;
}) {
  return (
    <div class={cn('rounded-xl border px-4 py-3 text-sm', tones[tone], className)}>
      {children}
    </div>
  );
}
