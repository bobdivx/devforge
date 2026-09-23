import { useEffect, useRef, useState } from 'preact/hooks';
import { cn } from '../lib/cn';
import {
  dismissLaunchedAgent,
  launchedStatusLabel,
  openLaunchedAgent,
  readLaunchedAgents,
  subscribeLaunchedAgents,
  type LaunchedAgent,
} from '../lib/launched-agents';

export function useLaunchedAgents(): LaunchedAgent[] {
  const [agents, setAgents] = useState<LaunchedAgent[]>([]);

  useEffect(() => {
    const sync = () => setAgents(readLaunchedAgents());
    sync();
    return subscribeLaunchedAgents(sync);
  }, []);

  return agents;
}

function StatusDot({ status }: { status: string }) {
  const working = status === 'working';
  return (
    <span
      class={cn(
        'h-1.5 w-1.5 shrink-0 rounded-full',
        working ? 'animate-pulse bg-[var(--color-warn)]' : 'bg-[var(--color-ok)]',
      )}
      aria-hidden
    />
  );
}

export function LaunchedAgentRows({
  agents,
  onOpen,
  dense = false,
}: {
  agents: LaunchedAgent[];
  onOpen?: () => void;
  dense?: boolean;
}) {
  if (agents.length === 0) {
    return (
      <p class={cn('text-sm text-[var(--color-ink-muted)]', dense ? 'px-3 py-2.5' : 'px-1 py-2')}>
        Aucun agent lancé. Ouvre Revue, Déploiements ou un autre agent depuis un projet : il reste
        accessible ici pendant la session.
      </p>
    );
  }

  return (
    <ul class="flex flex-col">
      {agents.map((agent) => {
        const status = launchedStatusLabel(agent.status);
        return (
          <li key={agent.uuid} class="flex items-stretch">
            <button
              type="button"
              class={cn(
                'flex min-w-0 flex-1 items-center gap-2.5 text-left transition hover:bg-white/5',
                dense ? 'px-3 py-2' : 'min-h-[44px] px-3 py-2.5',
              )}
              onClick={() => {
                openLaunchedAgent(agent);
                onOpen?.();
              }}
            >
              <StatusDot status={agent.status} />
              <span class="min-w-0 flex-1">
                <span class="block truncate text-sm font-medium text-[var(--color-ink)]">
                  {agent.title}
                </span>
                <span class="block truncate text-[11px] text-[var(--color-ink-muted)]">
                  {agent.projectName ? `${agent.projectName} · ${status}` : status}
                </span>
              </span>
            </button>
            <button
              type="button"
              class="shrink-0 px-3 text-sm text-[var(--color-ink-faint)] transition hover:bg-white/5 hover:text-[var(--color-ink)]"
              aria-label={`Retirer ${agent.title}`}
              onClick={() => dismissLaunchedAgent(agent.uuid)}
            >
              ×
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Accès header (tablette et desktop) aux agents lancés dans la session. */
export function LaunchedAgentsMenu() {
  const agents = useLaunchedAgents();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const latest = agents[0];
  const anyWorking = agents.some((agent) => agent.status === 'working');

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!latest) return null;

  function openLatest() {
    if (!latest) return;
    setOpen(false);
    openLaunchedAgent(latest);
  }

  return (
    <div class="relative hidden shrink-0 md:block" ref={rootRef}>
      <div class="flex min-h-[44px] items-center rounded-full border border-[var(--color-line)] bg-white/[0.03]">
        <button
          type="button"
          class="flex min-w-0 items-center gap-2 py-1 pl-2.5 pr-2 transition hover:text-[var(--color-ink)]"
          onClick={openLatest}
          title={latest.projectName ? `${latest.title} · ${latest.projectName}` : latest.title}
        >
          <StatusDot status={anyWorking ? 'working' : latest.status} />
          <span class="max-w-[9rem] truncate text-sm font-medium text-[var(--color-ink)]">
            {latest.title}
          </span>
        </button>
        {agents.length > 1 ? (
          <button
            type="button"
            class="flex h-8 items-center gap-1 border-l border-[var(--color-line)] px-2.5 text-[11px] font-medium text-[var(--color-ink-muted)] transition hover:text-[var(--color-ink)]"
            aria-expanded={open}
            aria-haspopup="menu"
            aria-label="Agents lancés"
            onClick={() => setOpen((value) => !value)}
          >
            {agents.length}
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              class={cn('transition-transform duration-200', open && 'rotate-180')}
              aria-hidden
            >
              <path d="M6 9l6 6 6-6" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>
        ) : (
          <button
            type="button"
            class="pr-2.5 text-sm text-[var(--color-ink-faint)] transition hover:text-[var(--color-ink)]"
            aria-label={`Retirer ${latest.title}`}
            onClick={() => dismissLaunchedAgent(latest.uuid)}
          >
            ×
          </button>
        )}
      </div>

      {open && agents.length > 1 && (
        <div
          role="menu"
          class="df-menu-enter absolute right-0 z-30 mt-2 w-72 overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] py-1 shadow-xl shadow-black/40"
        >
          <p class="px-3 pb-1 pt-1.5 text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--color-ink-faint)]">
            Agents lancés
          </p>
          <LaunchedAgentRows agents={agents} dense onOpen={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}
