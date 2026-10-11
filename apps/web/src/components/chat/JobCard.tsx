import { Check, ExternalLink, FileText, Square, X as XIcon } from 'lucide-preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { fmtElapsed } from '../../lib/activity';
import { subscribeRun } from '../../lib/agent-stream';
import { api, type AgentRunInfo, type Deployment } from '../../lib/api';
import { cn } from '../../lib/cn';
import {
  isJobLive,
  JOB_KIND_LABEL,
  JOB_STATUS_LABEL,
  jobStatusFromDeployment,
  jobStatusFromRun,
  milestonesFrom,
  type Job,
  type JobStatus,
} from '../../lib/jobs';
import { applyMilestone } from '../../lib/activity';
import { MilestoneBar } from './MilestoneBar';

/** Pastille de statut : point pulsé (en cours), coche (terminé), croix (échec). */
function StatusDot({ status }: { status: JobStatus }) {
  if (status === 'done') {
    return <Check key="done" size={14} strokeWidth={2.5} class="df-pop shrink-0 text-[var(--color-ok)]" aria-hidden />;
  }
  if (status === 'failed') {
    return <XIcon key="failed" size={14} strokeWidth={2.5} class="df-status-fail shrink-0 text-[var(--color-danger)]" aria-hidden />;
  }
  if (status === 'cancelled') {
    return <Square key="cancelled" size={11} strokeWidth={2.5} class="shrink-0 text-[var(--color-ink-faint)]" aria-hidden />;
  }
  return (
    <span key="live" class="relative inline-flex h-2.5 w-2.5 shrink-0" aria-hidden>
      <span
        class={cn(
          'df-status-live absolute inline-flex h-full w-full rounded-full',
          status === 'queued' ? 'bg-[var(--color-ink-faint)]' : 'bg-[var(--color-accent)]',
        )}
      />
      <span
        class={cn(
          'relative inline-flex h-2.5 w-2.5 rounded-full',
          status === 'queued' ? 'bg-[var(--color-ink-faint)]' : 'bg-[var(--color-accent)]',
        )}
      />
    </span>
  );
}

export type JobCardActions = {
  onOpenThread?: (workerUuid: string) => void;
  onCancel?: () => void;
  onToggleLogs?: () => void;
};

/** Rendu pur de la carte (testé par statut). */
export function JobCardView({
  job,
  nowMs,
  logs,
  logsOpen,
  cancelling,
  onOpenThread,
  onCancel,
  onToggleLogs,
}: {
  job: Job;
  nowMs: number;
  logs?: string[] | null;
  logsOpen?: boolean;
  cancelling?: boolean;
} & JobCardActions) {
  const live = isJobLive(job.status);
  const started = job.startedAt ? Date.parse(job.startedAt) : NaN;
  const elapsed =
    job.elapsedMs ?? (Number.isFinite(started) ? Math.max(0, (job.finishedAt ? Date.parse(job.finishedAt) : nowMs) - started) : undefined);
  return (
    <section
      class={cn(
        'df-fade-in max-w-full rounded-2xl border bg-[var(--color-card)] p-3 [transition:border-color_300ms_ease]',
        job.status === 'done'
          ? 'border-[var(--color-ok)]/60'
          : job.status === 'failed'
            ? 'border-[var(--color-danger)]/60'
            : 'border-[var(--color-line)]',
      )}
      data-testid="job-card"
      data-status={job.status}
      data-kind={job.kind}
      aria-label={`${JOB_KIND_LABEL[job.kind]} « ${job.title} » : ${JOB_STATUS_LABEL[job.status]}`}
    >
      <header class="flex min-w-0 items-center gap-2">
        <StatusDot status={job.status} />
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-medium text-[var(--color-ink)]" title={job.title}>
            {job.title}
          </p>
        </div>
        <span
          key={job.status}
          class={cn(
            'df-fade-in shrink-0 rounded-full border px-2 py-0.5 text-[11px] [animation-duration:160ms]',
            job.status === 'done' && 'border-[var(--color-ok)]/40 text-[var(--color-ok)]',
            job.status === 'failed' && 'border-[var(--color-danger)]/40 text-[var(--color-danger)]',
            (job.status === 'running' || job.status === 'queued' || job.status === 'cancelled') &&
              'border-[var(--color-line)] text-[var(--color-ink-muted)]',
          )}
          aria-live="polite"
        >
          {JOB_STATUS_LABEL[job.status]}
        </span>
      </header>
      <p class="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[12px] text-[var(--color-ink-faint)]">
        <span>{JOB_KIND_LABEL[job.kind]}</span>
        {elapsed !== undefined && elapsed > 0 ? (
          <>
            <span aria-hidden>·</span>
            <span class="tabular-nums" data-testid="job-elapsed">
              {fmtElapsed(elapsed)}
            </span>
          </>
        ) : null}
        {job.files && job.files.length > 0 ? (
          <>
            <span aria-hidden>·</span>
            <span>
              {job.files.length} fichier{job.files.length > 1 ? 's' : ''}
            </span>
          </>
        ) : null}
      </p>
      {job.milestones.length > 0 && <MilestoneBar items={job.milestones} class="mt-2" />}
      {job.summary ? (
        <p class="mt-2 break-words text-sm text-[var(--color-ink-muted)] [overflow-wrap:anywhere]" data-testid="job-summary">
          {job.summary}
        </p>
      ) : null}
      {logsOpen && logs && logs.length > 0 ? (
        <pre class="mt-2 max-h-40 overflow-auto rounded-lg bg-black/30 p-2 text-[11px] leading-4 text-[var(--color-ink-muted)]" data-testid="job-logs">
          {logs.join('\n')}
        </pre>
      ) : null}
      {(onOpenThread && job.workerUuid) || onToggleLogs || (live && onCancel) || job.links?.length ? (
        <div class="mt-2 flex flex-wrap items-center gap-1.5">
          {onOpenThread && job.workerUuid ? (
            <button
              type="button"
              class="df-hit inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-xs text-[var(--color-ink-muted)] hover:bg-white/[0.06] hover:text-[var(--color-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
              onClick={() => onOpenThread(job.workerUuid!)}
            >
              <ExternalLink size={13} aria-hidden />
              Ouvrir le fil
            </button>
          ) : null}
          {onToggleLogs ? (
            <button
              type="button"
              class="df-hit inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-xs text-[var(--color-ink-muted)] hover:bg-white/[0.06] hover:text-[var(--color-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
              aria-expanded={!!logsOpen}
              onClick={onToggleLogs}
            >
              <FileText size={13} aria-hidden />
              Logs
            </button>
          ) : null}
          {job.links?.map((l) => (
            <a
              key={l.href}
              href={l.href}
              target="_blank"
              rel="noreferrer"
              class="df-hit inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-xs text-[var(--color-accent)] hover:underline"
            >
              {l.label}
            </a>
          ))}
          {live && onCancel ? (
            <button
              type="button"
              class="df-hit ml-auto inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-xs text-[var(--color-danger)] hover:bg-red-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] disabled:opacity-50"
              disabled={cancelling}
              onClick={onCancel}
            >
              <Square size={11} aria-hidden />
              {cancelling ? 'Arrêt…' : 'Annuler'}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/** Accès réseau de la carte (remplaçable en test). */
export type JobClient = {
  agentRun: (runUuid: string) => Promise<{ data: AgentRunInfo }>;
  cancelAgentRun: (runUuid: string) => Promise<unknown>;
  deployment: (uuid: string) => Promise<{ data: Deployment }>;
  cancelDeployment: (uuid: string) => Promise<unknown>;
  deploymentLogs: (uuid: string) => Promise<unknown>;
  subscribeRun: typeof subscribeRun;
};

const defaultClient: JobClient = {
  agentRun: (id) => api.agentRun(id),
  cancelAgentRun: (id) => api.cancelAgentRun(id),
  deployment: (id) => api.deployment(id),
  cancelDeployment: (id) => api.cancelDeployment(id),
  deploymentLogs: (id) => api.deploymentLogs(id),
  subscribeRun,
};

function applyRun(job: Job, r: AgentRunInfo): Job {
  const status = jobStatusFromRun(r.status);
  return {
    ...job,
    title: r.title || job.title,
    status,
    milestones: r.progress && r.progress.length ? milestonesFrom(r.progress) : job.milestones,
    startedAt: r.started_at || job.startedAt,
    finishedAt: isJobLive(status) ? undefined : r.updated_at,
    summary: r.summary || job.summary,
  };
}

function logsText(raw: unknown): string[] {
  const r = raw as { data?: unknown; logs?: unknown };
  const text =
    typeof r?.data === 'string'
      ? r.data
      : typeof (r?.data as { logs?: unknown })?.logs === 'string'
        ? ((r.data as { logs: string }).logs)
        : typeof r?.logs === 'string'
          ? r.logs
          : '';
  return text.split('\n').filter((l) => l.trim()).slice(-30);
}

/**
 * Carte vivante : un worker suit les événements de son run (P4-02) ; un déploiement relit
 * son statut toutes les 3 s jusqu'à la fin. `onFinished` : la carte vient de se terminer.
 */
export function JobCard({
  initial,
  onOpenThread,
  onFinished,
  client = defaultClient,
}: {
  initial: Job;
  onOpenThread?: (workerUuid: string) => void;
  onFinished?: (job: Job) => void;
  client?: JobClient;
}) {
  const [job, setJob] = useState<Job>(initial);
  const [now, setNow] = useState(() => Date.now());
  const [logs, setLogs] = useState<string[]>([]);
  const [logsOpen, setLogsOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const finished = useRef(!isJobLive(initial.status));
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;

  const finish = (j: Job) => {
    if (finished.current) return;
    finished.current = true;
    onFinishedRef.current?.(j);
  };

  // Worker : état du run puis flux d'événements tant qu'il tourne.
  useEffect(() => {
    if (initial.kind !== 'worker') return;
    const ctrl = new AbortController();
    let alive = true;
    (async () => {
      try {
        const r = await client.agentRun(initial.runUuid);
        if (!alive) return;
        let current = applyRun(initial, r.data);
        setJob(current);
        if (!isJobLive(current.status)) return;
        await client.subscribeRun(
          initial.runUuid,
          {
            onMilestone: (label, status) =>
              setJob((j) => ({ ...j, status: 'running', milestones: applyMilestone(j.milestones, label, status) })),
            onToolStart: (call) => {
              setJob((j) => (j.status === 'queued' ? { ...j, status: 'running' } : j));
              setLogs((l) => [...l, `→ ${call.label || call.name}`].slice(-30));
            },
            onToolDone: (call, ok) => setLogs((l) => [...l, `${ok ? '✓' : '✗'} ${call.summary || call.label || call.name}`].slice(-30)),
          },
          ctrl.signal,
        ).catch(() => undefined);
        if (!alive) return;
        const end = await client.agentRun(initial.runUuid);
        if (!alive) return;
        current = applyRun(current, end.data);
        setJob(current);
        if (!isJobLive(current.status)) finish(current);
      } catch {
        /* run illisible : la carte garde son dernier état */
      }
    })();
    return () => {
      alive = false;
      ctrl.abort();
    };
  }, [initial.runUuid]);

  // Déploiement : statut relu toutes les 3 s.
  useEffect(() => {
    if (initial.kind !== 'deploy') return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const r = await client.deployment(initial.runUuid);
        if (!alive) return;
        const status = jobStatusFromDeployment(r.data.status);
        const next: Job = {
          ...initial,
          status,
          startedAt: r.data.created_at || initial.startedAt,
          finishedAt: isJobLive(status) ? undefined : new Date().toISOString(),
          summary: status === 'failed' ? r.data.error_summary || initial.summary : initial.summary,
        };
        setJob(next);
        if (!isJobLive(status)) {
          finish(next);
          return;
        }
      } catch {
        /* réseau : on réessaie */
      }
      if (alive) timer = setTimeout(tick, 3000);
    };
    void tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [initial.runUuid]);

  // Durée qui s'incrémente pendant le run.
  useEffect(() => {
    if (!isJobLive(job.status)) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [job.status]);

  const cancel = async () => {
    setCancelling(true);
    try {
      if (job.kind === 'deploy') await client.cancelDeployment(job.runUuid);
      else await client.cancelAgentRun(job.runUuid);
    } catch {
      setCancelling(false);
    }
  };

  const toggleLogs = async () => {
    const open = !logsOpen;
    setLogsOpen(open);
    if (open && job.kind === 'deploy') {
      try {
        setLogs(logsText(await client.deploymentLogs(job.runUuid)));
      } catch {
        setLogs(['Logs indisponibles.']);
      }
    }
  };

  const canLogs = job.kind === 'deploy' || logs.length > 0;
  return (
    <JobCardView
      job={job}
      nowMs={now}
      logs={logs}
      logsOpen={logsOpen}
      cancelling={cancelling}
      onOpenThread={onOpenThread}
      onCancel={job.kind === 'worker' || job.kind === 'deploy' ? cancel : undefined}
      onToggleLogs={canLogs ? toggleLogs : undefined}
    />
  );
}
