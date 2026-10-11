/**
 * Cartes de job (P4-04) : tâches longues dans le fil (worker délégué, déploiement).
 * Fonctions pures (testées) ; le composant est components/chat/JobCard.tsx.
 */
import type { Milestone, MilestoneState } from './activity';
import type { AgentToolCall } from './agent-stream';

export type JobKind = 'worker' | 'deploy' | 'preview' | 'routine';
export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export type Job = {
  /** Run (worker) ou déploiement : clé stable de la carte. */
  runUuid: string;
  kind: JobKind;
  title: string;
  status: JobStatus;
  milestones: Milestone[];
  startedAt?: string;
  finishedAt?: string;
  summary?: string;
  links?: { label: string; href: string }[];
  /** Fil du worker (« Ouvrir le fil »). */
  workerUuid?: string;
  files?: string[];
  elapsedMs?: number;
};

export function isJobLive(status: JobStatus): boolean {
  return status === 'queued' || status === 'running';
}

/** Statut `agent_runs` → statut de carte. */
export function jobStatusFromRun(status: string | undefined | null): JobStatus {
  switch (status) {
    case 'queued':
      return 'queued';
    case 'pending':
    case 'running':
    case 'started':
    case 'already_running':
      return 'running';
    case 'completed':
    case 'done':
      return 'done';
    case 'cancelled':
      return 'cancelled';
    case 'failed':
      return 'failed';
    default:
      return 'running';
  }
}

/** Statut de déploiement → statut de carte. */
export function jobStatusFromDeployment(status: string | undefined | null): JobStatus {
  const s = (status || '').toLowerCase();
  if (s === 'queued' || s === 'pending') return 'queued';
  if (s === 'success' || s === 'succeeded' || s === 'done') return 'done';
  if (s === 'cancelled' || s === 'canceled') return 'cancelled';
  if (s === 'failed' || s === 'error' || s === 'timeout') return 'failed';
  return 'running';
}

export const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  queued: 'En file',
  running: 'En cours',
  done: 'Terminé',
  failed: 'Échec',
  cancelled: 'Annulé',
};

export const JOB_KIND_LABEL: Record<JobKind, string> = {
  worker: 'Worker',
  deploy: 'Mise en ligne',
  preview: 'Aperçu',
  routine: 'Routine',
};

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** Milestones `agent_runs.progress` → jalons de la carte. */
export function milestonesFrom(progress: Array<{ label: string; status: string }> | undefined | null): Milestone[] {
  return (progress ?? [])
    .filter((m) => m && m.label)
    .map((m) => ({
      label: m.label,
      status: (m.status === 'done' || m.status === 'failed' ? m.status : 'running') as MilestoneState,
    }));
}

/** Cartes à afficher pour les outils d'un message (une par run / déploiement). */
export function jobsFromToolCalls(tools: AgentToolCall[]): Job[] {
  const jobs = new Map<string, Job>();
  for (const t of tools) {
    const r = (t.result ?? {}) as Record<string, unknown>;
    if (t.name === 'delegate_task' && r.ok !== false && str(r.run_uuid)) {
      const id = str(r.run_uuid);
      if (jobs.has(id)) continue;
      jobs.set(id, {
        runUuid: id,
        kind: 'worker',
        title: str(r.title) || str(t.arguments?.title) || 'Tâche déléguée',
        status: jobStatusFromRun(str(r.status)),
        milestones: [],
        workerUuid: str(r.worker_uuid) || undefined,
      });
    } else if (t.name === 'job_result' && str(r.run_uuid)) {
      const id = str(r.run_uuid);
      jobs.set(id, {
        runUuid: id,
        kind: (str(r.kind) as JobKind) || 'worker',
        title: str(r.title) || 'Tâche',
        status: jobStatusFromRun(str(r.status)),
        milestones: [],
        summary: str(r.summary) || undefined,
        workerUuid: str(r.worker_uuid) || undefined,
        files: Array.isArray(r.files) ? r.files.map((f) => String(f)) : undefined,
        elapsedMs: typeof r.elapsed_ms === 'number' ? r.elapsed_ms : undefined,
      });
    } else if (t.name === 'trigger_deploy' && str(r.deployment_uuid)) {
      const id = str(r.deployment_uuid);
      if (jobs.has(id)) continue;
      jobs.set(id, {
        runUuid: id,
        kind: 'deploy',
        title: 'Mise en ligne',
        status: jobStatusFromDeployment(str(r.status)),
        milestones: [],
        summary: r.ok === false ? str(r.error) || str(r.message) || undefined : undefined,
      });
    }
  }
  return [...jobs.values()];
}
