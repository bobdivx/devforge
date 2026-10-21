import { describe, expect, it } from 'vitest';
import { installNeeds, workerSummary } from './CursorWorkerSettingsPanel';

const base = {
  running: false,
  ready: null,
  cli_installed: false,
  api_key_set: false,
  node_missing: false,
  node_error: null,
};

describe('workerSummary', () => {
  it('asks to install when key or CLI is missing', () => {
    expect(workerSummary(base)).toMatchObject({ label: 'À installer', installed: false });
    expect(workerSummary({ ...base, api_key_set: true })).toMatchObject({ installed: false });
  });
  it('reports running / connecting / stopped', () => {
    const ok = { ...base, cli_installed: true, api_key_set: true };
    expect(workerSummary({ ...ok, running: true, ready: true })).toMatchObject({ label: 'ON', tone: 'ok' });
    expect(workerSummary({ ...ok, running: true, ready: false })).toMatchObject({ tone: 'accent' });
    expect(workerSummary(ok)).toMatchObject({ label: 'Off', installed: true });
  });
  it('flags unreachable or missing nodes', () => {
    expect(workerSummary({ ...base, node_error: 'down' }).tone).toBe('danger');
    expect(workerSummary({ ...base, node_missing: true }).tone).toBe('danger');
  });
});

describe('installNeeds', () => {
  it('only asks for the Cursor API key, and only when none is stored', () => {
    expect(installNeeds({ api_key_set: false })).toEqual(['api_key']);
    expect(installNeeds({ api_key_set: true })).toEqual([]);
    expect(installNeeds(null)).toEqual([]);
  });
});
