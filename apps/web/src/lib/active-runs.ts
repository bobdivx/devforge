/**
 * Rangée « En cours » : runs d'agent lus côté serveur (durables, survivent aux redémarrages
 * grâce aux baux SQL). Fonctions pures testées ; composant : components/ActiveRuns.tsx.
 */
import type { AgentRunInfo } from './api';
import { JOB_STATUS_LABEL, jobStatusFromRun, type Job, type JobKind } from './jobs';

/** Ordre d'affichage : en cours, en file, en pause, puis échecs. */
const ORDER: Record<string, number> = { running: 0, queued: 1, paused: 2, failed: 3 };

export function sortActiveRuns(runs: AgentRunInfo[]): AgentRunInfo[] {
  return [...runs].sort(
    (a, b) =>
      (ORDER[jobStatusFromRun(a.status)] ?? 9) - (ORDER[jobStatusFromRun(b.status)] ?? 9) ||
      (b.started_at || '').localeCompare(a.started_at || ''),
  );
}

export function activeRunTitle(run: AgentRunInfo): string {
  return (run.title || '').trim() || (run.agent_name || '').trim() || (run.kind === 'routine' ? 'Routine' : 'Tâche');
}

/** Sous-titre court : « Projet · En pause ». */
export function activeRunSubtitle(run: AgentRunInfo): string {
  const status = JOB_STATUS_LABEL[jobStatusFromRun(run.status)];
  return run.project_name ? `${run.project_name} · ${status}` : status;
}

/** Nombre affiché sur la pastille : seulement ce qui tourne ou attend. */
export function liveCount(runs: AgentRunInfo[]): number {
  return runs.filter((r) => ['running', 'queued'].includes(jobStatusFromRun(r.status))).length;
}

export function jobFromRun(run: AgentRunInfo): Job {
  const kind: JobKind = run.kind === 'routine' ? 'routine' : 'worker';
  return {
    runUuid: run.run_uuid,
    kind,
    title: activeRunTitle(run),
    status: jobStatusFromRun(run.status),
    milestones: [],
    startedAt: run.started_at,
    summary: run.summary || run.error || undefined,
  };
}
