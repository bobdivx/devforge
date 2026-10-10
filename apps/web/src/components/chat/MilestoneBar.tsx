import { Check, X } from 'lucide-preact';
import type { Milestone } from '../../lib/activity';
import { cn } from '../../lib/cn';

/** Progression compacte du run : « Modification ✓ · Build ✓ · Preview … » (P2-03). */
export function MilestoneBar({ items, class: className }: { items: Milestone[]; class?: string }) {
  if (!items.length) return null;
  return (
    <ol
      class={cn('flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12px] text-[var(--color-ink-muted)]', className)}
      aria-label="Progression"
      data-testid="milestone-bar"
    >
      {items.map((m, i) => (
        <li key={m.label} class="df-step-fade inline-flex items-center gap-1" data-status={m.status}>
          {i > 0 ? (
            <span class="text-[var(--color-ink-faint)]" aria-hidden>
              ·
            </span>
          ) : null}
          <span class={cn(m.status === 'failed' && 'text-[var(--color-danger)]', m.status === 'running' && 'text-[var(--color-ink)]')}>
            {m.label}
          </span>
          {m.status === 'done' ? (
            <Check key="ok" size={12} strokeWidth={2.5} class="df-pop text-[var(--color-ok)]" aria-label="terminé" />
          ) : m.status === 'failed' ? (
            <X key="ko" size={12} strokeWidth={2.5} class="df-pop text-[var(--color-danger)]" aria-label="échec" />
          ) : (
            <span class="text-[var(--color-ink-faint)]" aria-label="en cours">
              …
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}
