import { render, waitFor } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import type { AgentRunInfo } from '../../lib/api';
import { jobsFromToolCalls, jobStatusFromDeployment, jobStatusFromRun, type Job, type JobStatus } from '../../lib/jobs';
import { JobCard, JobCardView, type JobClient } from './JobCard';

const NOW = Date.parse('2026-10-11T10:00:00Z');

function job(status: JobStatus, over: Partial<Job> = {}): Job {
  return {
    runUuid: 'run-1',
    kind: 'worker',
    title: 'Refonte de la page d’accueil',
    status,
    milestones: [],
    startedAt: '2026-10-11T09:58:30Z',
    workerUuid: 'w1',
    ...over,
  };
}

describe('jobs (P4-04)', () => {
  it('statuts run et déploiement', () => {
    expect(['pending', 'running', 'queued', 'completed', 'failed', 'cancelled', 'already_running'].map(jobStatusFromRun)).toEqual([
      'running',
      'running',
      'queued',
      'done',
      'failed',
      'cancelled',
      'running',
    ]);
    expect(['queued', 'running', 'success', 'failed', 'cancelled'].map(jobStatusFromDeployment)).toEqual([
      'queued',
      'running',
      'done',
      'failed',
      'cancelled',
    ]);
  });

  it('cartes depuis les outils : délégation, résultat (prioritaire), déploiement', () => {
    const jobs = jobsFromToolCalls([
      { name: 'delegate_task', arguments: { title: 'T' }, result: { ok: true, status: 'started', run_uuid: 'r1', worker_uuid: 'w1', title: 'Refonte' } },
      { name: 'job_result', result: { run_uuid: 'r1', status: 'completed', title: 'Refonte', summary: 'Fait.', files: ['a.ts'], elapsed_ms: 5000 } },
      { name: 'trigger_deploy', result: { ok: true, async: true, deployment_uuid: 'd1', status: 'running' } },
      { name: 'delegate_task', result: { ok: false, error: 'non' } },
      { name: 'read_project_file', result: { ok: true } },
    ]);
    expect(jobs.map((j) => [j.runUuid, j.kind, j.status])).toEqual([
      ['r1', 'worker', 'done'],
      ['d1', 'deploy', 'running'],
    ]);
    expect(jobs[0].summary).toBe('Fait.');
  });
});

describe('JobCardView : un rendu par statut', () => {
  for (const status of ['queued', 'running', 'done', 'failed', 'cancelled'] as JobStatus[]) {
    it(status, () => {
      const j = job(status, {
        milestones: status === 'running' ? [{ label: 'Modification', status: 'done' }, { label: 'Build', status: 'running' }] : [],
        summary: status === 'done' ? 'Accueil refait, build OK.' : status === 'failed' ? 'Build en échec.' : undefined,
        finishedAt: status === 'done' || status === 'failed' ? '2026-10-11T09:59:40Z' : undefined,
      });
      const { container } = render(<JobCardView job={j} nowMs={NOW} onCancel={() => undefined} onOpenThread={() => undefined} />);
      const card = container.querySelector('[data-testid="job-card"]')!;
      expect(card.getAttribute('data-status')).toBe(status);
      const live = status === 'queued' || status === 'running';
      expect(!!container.querySelector('button:last-child')?.textContent?.includes('Annuler')).toBe(live);
      expect(card.textContent).toContain('Ouvrir le fil');
      expect(container.innerHTML).toMatchSnapshot();
    });
  }

  it('la durée s’incrémente pendant le run et se fige à la fin', () => {
    const { container, rerender } = render(<JobCardView job={job('running')} nowMs={NOW} />);
    expect(container.querySelector('[data-testid="job-elapsed"]')!.textContent).toBe('1 min 30 s');
    rerender(<JobCardView job={job('running')} nowMs={NOW + 5000} />);
    expect(container.querySelector('[data-testid="job-elapsed"]')!.textContent).toBe('1 min 35 s');
    rerender(<JobCardView job={job('done', { finishedAt: '2026-10-11T09:59:00Z' })} nowMs={NOW + 60_000} />);
    expect(container.querySelector('[data-testid="job-elapsed"]')!.textContent).toBe('30 s');
  });
});

describe('JobCard vivante : transition running → done', () => {
  it('suit les jalons du run puis passe à Terminé', async () => {
    const run = (status: string, extra: Partial<AgentRunInfo> = {}): { data: AgentRunInfo } => ({
      data: {
        run_uuid: 'run-1',
        project_uuid: 'p',
        agent_uuid: 'w1',
        status,
        kind: 'worker',
        title: 'Refonte',
        started_at: '2026-10-11T09:58:30Z',
        updated_at: '2026-10-11T09:59:30Z',
        ...extra,
      },
    });
    let release: () => void = () => undefined;
    const client: JobClient = {
      agentRun: vi.fn().mockResolvedValueOnce(run('running')).mockResolvedValueOnce(run('completed', { summary: 'Fait, build OK.' })),
      cancelAgentRun: vi.fn(),
      deployment: vi.fn(),
      cancelDeployment: vi.fn(),
      deploymentLogs: vi.fn(),
      subscribeRun: vi.fn(async (_id, handlers) => {
        handlers?.onMilestone?.('Build', 'running');
        await new Promise<void>((r) => (release = r));
        handlers?.onMilestone?.('Build', 'done');
        return { reply: 'ok', tool_calls: [] };
      }) as unknown as JobClient['subscribeRun'],
    };
    const onFinished = vi.fn();
    const { container } = render(<JobCard initial={job('running', { title: 'Refonte' })} client={client} onFinished={onFinished} />);
    const card = () => container.querySelector('[data-testid="job-card"]')!;
    await waitFor(() => expect(card().textContent).toContain('Build'));
    expect(card().getAttribute('data-status')).toBe('running');
    release();
    await waitFor(() => expect(card().getAttribute('data-status')).toBe('done'));
    expect(card().textContent).toContain('Fait, build OK.');
    expect(onFinished).toHaveBeenCalledTimes(1);
  });
});
