import { useEffect, useState } from 'preact/hooks';
import { api, type AgentRunInfo } from '../lib/api';
import { activeRunSubtitle, activeRunTitle, jobFromRun, liveCount, sortActiveRuns } from '../lib/active-runs';
import { cn } from '../lib/cn';
import { jobStatusFromRun } from '../lib/jobs';
import { JobCard } from './chat/JobCard';
import { Modal } from './ui';
import { RunLiveCard } from './RunLiveCard';
import { WakeGrokButton } from './WakeGrokButton';

/** Runs actifs de l'espace, relus toutes les 10 s tant que l'onglet est visible. */
export function useActiveRuns(enabled = true, intervalMs = 10000): [AgentRunInfo[], () => void] {
  const [runs, setRuns] = useState<AgentRunInfo[]>([]);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const load = async () => {
      if (document.hidden) return;
      try {
        const r = await api.activeAgentRuns();
        if (alive) setRuns(sortActiveRuns(r.data ?? []));
      } catch {
        /* hors ligne : on garde la dernière liste */
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), intervalMs);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [enabled, intervalMs, tick]);
  return [runs, () => setTick((n) => n + 1)];
}

function Dot({ status }: { status: string }) {
  const s = jobStatusFromRun(status);
  return (
    <span
      class={cn(
        'h-2 w-2 shrink-0 rounded-full',
        s === 'running' && 'animate-pulse bg-[var(--color-accent)]',
        s === 'queued' && 'bg-[var(--color-ink-faint)]',
        s === 'paused' && 'border border-[var(--color-ink-muted)]',
        s === 'failed' && 'bg-[var(--color-danger)]',
      )}
      aria-hidden
    />
  );
}

/** Lignes simples ; le détail et les actions (pause, reprise, relance) sont dans la modale. */
export function ActiveRunRows({ runs, onPick }: { runs: AgentRunInfo[]; onPick: (run: AgentRunInfo) => void }) {
  return (
    <ul class="flex flex-col" data-testid="active-runs">
      {runs.map((run) => (
        <li key={run.run_uuid}>
          <button
            type="button"
            class="flex min-h-[44px] w-full min-w-0 items-center gap-2.5 px-3 py-2 text-left transition hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]"
            onClick={() => onPick(run)}
          >
            <Dot status={run.status} />
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-medium text-[var(--color-ink)]">{activeRunTitle(run)}</span>
              <span class="block truncate text-[11px] text-[var(--color-ink-muted)]">{activeRunSubtitle(run)}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function ActiveRunModal({ run, onClose }: { run: AgentRunInfo | null; onClose: () => void }) {
  return (
    <Modal open={!!run} onClose={onClose} title={run ? activeRunTitle(run) : ''} size="sm">
      {run ? (
        run.playbook ? (
          <RunLiveCard key={run.run_uuid} runUuid={run.run_uuid} />
        ) : (
          <>
            <JobCard key={run.run_uuid} initial={jobFromRun(run)} />
            {run.status === 'failed' && (
              <div class="mt-3">
                <WakeGrokButton projectUuid={run.project_uuid} runUuid={run.run_uuid} variant="primary" />
              </div>
            )}
          </>
        )
      ) : null}
    </Modal>
  );
}

/** Section « En cours » (feuille mobile des agents). Rien si aucun run. */
export function ActiveRunsSection({ enabled = true }: { enabled?: boolean }) {
  const [runs, reload] = useActiveRuns(enabled);
  const [picked, setPicked] = useState<AgentRunInfo | null>(null);
  if (runs.length === 0) return null;
  return (
    <div class="mb-2 border-b border-[var(--color-line)] pb-2">
      <p class="px-3 pb-1 pt-1.5 text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--color-ink-faint)]">En cours</p>
      <ActiveRunRows runs={runs} onPick={setPicked} />
      <ActiveRunModal
        run={picked}
        onClose={() => {
          setPicked(null);
          reload();
        }}
      />
    </div>
  );
}

/** Pastille d'en-tête (tablette, desktop) : « 2 en cours », liste puis détail en modale. */
export function ActiveRunsMenu() {
  const [runs, reload] = useActiveRuns();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<AgentRunInfo | null>(null);
  if (runs.length === 0) return null;
  const live = liveCount(runs);
  return (
    <>
      <button
        type="button"
        class="hidden min-h-[44px] shrink-0 items-center gap-2 rounded-full border border-[var(--color-line)] bg-white/[0.03] px-3 text-sm text-[var(--color-ink)] transition hover:border-white/20 focus-visible:outline-2 focus-visible:outline-[var(--color-accent)] md:flex"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <Dot status={live > 0 ? 'running' : runs[0].status} />
        {live > 0 ? `${live} en cours` : `${runs.length} à voir`}
      </button>
      <Modal open={open && !picked} onClose={() => setOpen(false)} title="En cours" size="sm" padded={false}>
        <div class="py-1">
          <ActiveRunRows runs={runs} onPick={setPicked} />
        </div>
      </Modal>
      <ActiveRunModal
        run={picked}
        onClose={() => {
          setPicked(null);
          reload();
        }}
      />
    </>
  );
}
