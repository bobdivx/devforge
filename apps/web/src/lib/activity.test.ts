import { describe, expect, it } from 'vitest';
import {
  activityItems,
  activitySummary,
  applyMilestone,
  fmtElapsed,
  mergeLiveFinal,
  pillText,
  type LiveAction,
} from './activity';

const live: LiveAction[] = [
  { call_id: 'c1', name: 'read_project_file', arguments: { path: 'src/app.ts' }, status: 'ok', label: 'Lecture de src/app.ts', seq: 1 },
  { call_id: 'c2', name: 'write_project_file', arguments: { path: 'src/app.ts', mode: 'local' }, status: 'ok', seq: 2 },
  { call_id: 'c3', name: 'run_workdir_command', arguments: { command: 'npm run build' }, status: 'running', seq: 3 },
];

describe('pillText', () => {
  it('présent pendant, passé après, durée si ≥ 1 s', () => {
    expect(pillText({ ...live[0], status: 'running' })).toBe('Lit app.ts…');
    expect(pillText(live[0])).toBe('A lu app.ts');
    expect(pillText(live[2])).toBe('Lance npm run build…');
    expect(pillText({ ...live[2], status: 'ok', elapsed_ms: 12_300 })).toBe('A lancé npm run build · 12 s');
    expect(pillText({ ...live[2], status: 'fail', summary: '✗ npm install : ERESOLVE' })).toBe('npm install : ERESOLVE');
  });
});

describe('activitySummary', () => {
  it('« 8 actions · 2 fichiers modifiés · 34 s »', () => {
    const tools: LiveAction[] = [
      ...Array.from({ length: 5 }, (_, i) => ({ name: 'read_project_file', arguments: { path: `f${i}` }, status: 'ok' as const })),
      { name: 'write_project_file', arguments: { path: 'a.ts' }, status: 'ok' },
      { name: 'write_project_file', arguments: { path: 'b.ts' }, status: 'ok' },
      { name: 'write_project_file', arguments: { path: 'a.ts' }, status: 'ok' },
    ];
    expect(activitySummary(tools, 34_000)).toBe('8 actions · 2 fichiers modifiés · 34 s');
    expect(activitySummary(tools.slice(0, 1))).toBe('1 action');
  });
  it('compte les échecs', () => {
    expect(activitySummary([{ name: 'x', status: 'fail' } as LiveAction])).toBe('1 action · 1 échec');
  });
});

describe('mergeLiveFinal', () => {
  it('fusionne par id, garde libellé/ordre, remplace les résultats', () => {
    const final = [
      { call_id: 'c3', name: 'run_workdir_command', arguments: { command: 'npm run build' }, result: { ok: true, exit_code: 0 } },
      { call_id: 'c1', name: 'read_project_file', arguments: { path: 'src/app.ts' }, result: { ok: true, content: 'complet' } },
      { call_id: 'c2', name: 'write_project_file', arguments: { path: 'src/app.ts' }, result: { ok: true, unified_diff: '+x' } },
    ];
    const out = mergeLiveFinal(live, final);
    expect(out.map((a) => a.call_id)).toEqual(['c1', 'c2', 'c3']);
    expect(out[0].label).toBe('Lecture de src/app.ts');
    expect(out[0].result?.content).toBe('complet');
    expect(out[2].status).toBe('ok');
    expect(out.map((a) => a.seq)).toEqual([1, 2, 3]);
  });
  it('ajoute les outils absents du live, échec conservé', () => {
    const out = mergeLiveFinal([], [{ name: 'get_project', result: { ok: false } }]);
    expect(out).toHaveLength(1);
    expect(out[0].status).toBe('fail');
  });
});

describe('activityItems / applyMilestone / fmtElapsed', () => {
  it('réflexions et outils dans l’ordre d’arrivée', () => {
    const items = activityItems(live, [{ label: 'r', detail: 'pense', round: 1, seq: 0 }]);
    expect(items.map((i) => i.kind)).toEqual(['reflection', 'tool', 'tool', 'tool']);
  });
  it('jalon : ajout puis mise à jour sur place', () => {
    let m = applyMilestone([], 'Build', 'running');
    m = applyMilestone(m, 'Preview locale', 'running');
    m = applyMilestone(m, 'Build', 'done');
    expect(m).toEqual([
      { label: 'Build', status: 'done' },
      { label: 'Preview locale', status: 'running' },
    ]);
  });
  it('durées', () => {
    expect(fmtElapsed(40)).toBe('40 ms');
    expect(fmtElapsed(65_000)).toBe('1 min 05 s');
  });
});
