import { describe, expect, it } from 'vitest';
import type { RunLive } from './api';
import { counterPills, evidenceLink, needsHelp, outcomeTone, stepTone, workerState } from './run-live';

const counters = (c: Partial<RunLive['counters']>): Pick<RunLive, 'counters'> => ({
  counters: { tools_ok: 0, tools_failed: 0, workers_total: 0, workers_done: 0, workers_failed: 0, decisions: 0, ...c },
});

describe('run-live', () => {
  it('maps step states to tones, missing is never green', () => {
    expect(stepTone('ok')).toBe('ok');
    expect(stepTone('missing')).toBe('warn');
    expect(stepTone('failed')).toBe('danger');
    expect(stepTone('pending')).toBe('muted');
  });

  it('maps worker statuses', () => {
    expect(workerState('completed')).toBe('ok');
    expect(workerState('cancelled')).toBe('failed');
    expect(workerState('queued')).toBe('pending');
  });

  it('builds counter pills', () => {
    const p = counterPills(counters({ tools_ok: 3, tools_failed: 1, workers_total: 2, workers_done: 1, decisions: 2 }));
    expect(p.map((x) => x.label)).toEqual(['Workers 1/2', '3 actions OK', '1 échec', '2 décisions']);
    expect(counterPills(counters({})).map((x) => x.key)).toEqual(['tools', 'decisions']);
    expect(counterPills(counters({ workers_total: 2, workers_done: 1, workers_failed: 1 }))[0].tone).toBe('danger');
  });

  it('only links http(s) or internal routes', () => {
    expect(evidenceLink('https://x.fr/a')).toEqual({ href: 'https://x.fr/a', external: true });
    expect(evidenceLink('/app/receipts#r1')).toEqual({ href: '/app/receipts#r1', external: false });
    expect(evidenceLink('src/main.rs')).toBeNull();
    expect(evidenceLink('javascript:alert(1)')).toBeNull();
  });

  it('flags runs that need help', () => {
    expect(needsHelp({ verdict: 'failed' })).toBe(true);
    expect(needsHelp({ verdict: 'incomplete' })).toBe(true);
    expect(needsHelp({ verdict: 'ok' })).toBe(false);
    expect(outcomeTone('unknown')).toBe('danger');
  });
});
