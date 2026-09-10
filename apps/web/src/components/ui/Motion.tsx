import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { cn } from '../../lib/cn';

export function FadeIn({
  children,
  class: className,
  delay = 0,
}: {
  children: ComponentChildren;
  class?: string;
  delay?: number;
}) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setOn(true), delay);
    return () => clearTimeout(t);
  }, [delay]);
  return (
    <div
      class={cn(
        'transition-all duration-500 ease-out',
        on ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Spinner({ class: className }: { class?: string }) {
  return (
    <span
      class={cn(
        'inline-block h-4 w-4 animate-spin rounded-full border-2 border-[var(--color-accent)] border-t-transparent',
        className,
      )}
      aria-hidden
    />
  );
}

export function PulseDot({
  tone = 'ok',
  class: className,
}: {
  tone?: 'ok' | 'warn' | 'accent' | 'muted';
  class?: string;
}) {
  const colors = {
    ok: 'bg-[var(--color-ok)]',
    warn: 'bg-[var(--color-warn)]',
    accent: 'bg-[var(--color-accent)]',
    muted: 'bg-[var(--color-ink-faint)]',
  };
  return (
    <span class={cn('relative inline-flex h-2 w-2', className)}>
      <span
        class={cn(
          'absolute inline-flex h-full w-full animate-ping rounded-full opacity-40',
          colors[tone],
        )}
      />
      <span class={cn('relative inline-flex h-2 w-2 rounded-full', colors[tone])} />
    </span>
  );
}

export function ProgressBar({
  value,
  class: className,
}: {
  value: number;
  class?: string;
}) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div
      class={cn(
        'h-1.5 w-full overflow-hidden rounded-full bg-white/10',
        className,
      )}
    >
      <div
        class="h-full rounded-full bg-gradient-to-r from-[var(--color-accent)] to-[var(--color-accent-2)] transition-all duration-500 ease-out"
        style={{ width: `${v}%` }}
      />
    </div>
  );
}

export function Skeleton({ class: className }: { class?: string }) {
  return (
    <div
      class={cn(
        'animate-pulse rounded-xl bg-white/5',
        className,
      )}
    />
  );
}

export function LiveStatus({
  label,
  detail,
  busy,
}: {
  label: string;
  detail?: string;
  busy?: boolean;
}) {
  return (
    <div class="flex items-center gap-3 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-sm">
      {busy ? <Spinner /> : <PulseDot tone="ok" />}
      <div class="min-w-0">
        <div class="font-medium text-[var(--color-ink)]">{label}</div>
        {detail && (
          <div class="truncate text-xs text-[var(--color-ink-muted)]">{detail}</div>
        )}
      </div>
    </div>
  );
}
