import type { ClusterLocal } from '../lib/api';
import { cn } from '../lib/cn';

type Phase = 'loading' | 'ready' | 'error';

function hostOf(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/+$/, '');
}

function linkMeta(state?: string): { label: string; dot: string } {
  if (state === 'ok') {
    return { label: 'Leader joignable', dot: 'bg-[var(--color-ok)]' };
  }
  if (state === 'down') {
    return { label: 'Leader injoignable', dot: 'bg-[var(--color-danger)]' };
  }
  return { label: 'Contact en attente', dot: 'bg-[var(--color-warn)]' };
}

export function WorkerRail({
  status,
  phase,
  variant,
}: {
  status: ClusterLocal | null;
  phase: Phase;
  variant: 'sidebar' | 'banner';
}) {
  const name = status?.node_name?.trim() || 'Nœud';
  const id = status?.node_id ? status.node_id.slice(0, 8) : '—';
  const version = status?.version || status?.metrics?.software_version || '';
  const leader = (status?.leader_url || '').trim().replace(/\/+$/, '');
  const link = linkMeta(status?.link?.state);
  const banner = variant === 'banner';

  return (
    <div
      class={cn(
        banner
          ? 'rounded-2xl border border-[var(--color-line)] bg-[var(--color-card)] p-3'
          : 'mb-6 border-b border-[var(--color-line)] pb-4',
      )}
      aria-label="Identité du nœud"
    >
      <p
        class={cn(
          'text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--color-ink-faint)]',
          !banner && 'px-3',
        )}
      >
        Ce nœud
      </p>

      {phase === 'loading' ? (
        <div class={cn('mt-2 space-y-2', !banner && 'px-3')} aria-hidden>
          <div class="h-4 w-24 animate-pulse rounded bg-white/10" />
          <div class="h-3 w-16 animate-pulse rounded bg-white/5" />
          <div class="h-3 w-28 animate-pulse rounded bg-white/5" />
        </div>
      ) : phase === 'error' ? (
        <p class={cn('mt-2 text-xs text-[var(--color-ink-muted)]', !banner && 'px-3')}>
          Impossible de lire l’état de ce nœud.
        </p>
      ) : (
        <div class={cn(banner && 'mt-2 flex flex-col gap-2')}>
          <div class={cn(banner && 'min-w-0')}>
            <p class={cn('truncate text-sm font-medium text-[var(--color-ink)]', !banner && 'mt-1 px-3')}>
              {name}
            </p>
            <p
              class={cn(
                'truncate font-mono text-[11px] text-[var(--color-ink-muted)]',
                !banner && 'px-3',
              )}
            >
              {id}
              {version ? ` · v${version.replace(/^v/, '')}` : ''}
            </p>
          </div>
          <p
            class={cn(
              'flex items-center gap-2 text-xs text-[var(--color-ink)]',
              !banner && 'mt-2 px-3',
            )}
          >
            <span class={cn('h-1.5 w-1.5 shrink-0 rounded-full', link.dot)} aria-hidden />
            <span class="truncate">{link.label}</span>
          </p>
          {leader ? (
            <a
              href={leader}
              target="_blank"
              rel="noreferrer"
              title={`Ouvre ${hostOf(leader)} dans un nouvel onglet`}
              class={cn(
                'block truncate rounded-lg text-sm text-[var(--color-accent)] transition-colors hover:bg-white/5',
                banner ? 'px-0 py-1' : 'mx-1 mt-2 px-2 py-2',
              )}
            >
              Ouvrir le leader
              <span class="mt-0.5 block truncate text-[11px] font-normal text-[var(--color-ink-muted)]">
                {hostOf(leader)}
              </span>
            </a>
          ) : (
            <a
              href="/app/node?tab=adresses"
              class={cn(
                'block rounded-lg text-sm text-[var(--color-accent)] hover:bg-white/5',
                banner ? 'py-1' : 'mx-1 mt-2 px-2 py-2',
              )}
            >
              Renseigner le leader
            </a>
          )}
          <p class={cn('text-[11px] leading-relaxed text-[var(--color-ink-muted)]', !banner && 'mt-2 px-3')}>
            Apps, agents et comptes se gèrent sur le leader.
          </p>
        </div>
      )}
    </div>
  );
}
