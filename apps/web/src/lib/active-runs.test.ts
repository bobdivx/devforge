import { describe, expect, it } from 'vitest';
import type { AgentRunInfo } from './api';
import { activeRunSubtitle, jobFromRun, liveCount, sortActiveRuns } from './active-runs';
import { jobControls, jobStatusFromRun } from './jobs';

function run(uuid: string, status: string, over: Partial<AgentRunInfo> = {}): AgentRunInfo {
  return {
    run_uuid: uuid,
    project_uuid: 'p',
    agent_uuid: 'a',
    status,
    kind: 'worker',
    started_at: '2026-10-25T10:00:00Z',
    updated_at: '2026-10-25T10:00:00Z',
    ...over,
  };
}

describe('rangée « En cours » (baux SQL)', () => {
  it('trie en cours, file, pause, échec et compte ce qui tourne', () => {
    const runs = [run('f', 'failed'), run('p', 'paused'), run('q', 'queued'), run('r', 'running'), run('n', 'pending')];
    expect(sortActiveRuns(runs).map((r) => r.run_uuid)).toEqual(['r', 'n', 'q', 'p', 'f']);
    expect(liveCount(runs)).toBe(3);
  });

  it('statut en pause, sous-titre et carte', () => {
    expect(jobStatusFromRun('paused')).toBe('paused');
    expect(activeRunSubtitle(run('p', 'paused', { project_name: 'Site' }))).toBe('Site · En pause');
    const j = jobFromRun(run('f', 'failed', { title: 'Refonte', error: 'Interrompu par un redémarrage de DevForge.' }));
    expect(j.summary).toContain('redémarrage');
    expect(jobFromRun(run('r', 'running', { kind: 'routine' })).kind).toBe('routine');
  });

  it('actions proposées selon le statut', () => {
    expect(jobControls({ kind: 'worker', status: 'running' })).toEqual({ pause: true, resume: false, retry: false });
    expect(jobControls({ kind: 'worker', status: 'paused' })).toEqual({ pause: false, resume: true, retry: false });
    expect(jobControls({ kind: 'worker', status: 'failed' })).toEqual({ pause: false, resume: false, retry: true });
    expect(jobControls({ kind: 'deploy', status: 'running' })).toEqual({ pause: false, resume: false, retry: false });
  });
});
