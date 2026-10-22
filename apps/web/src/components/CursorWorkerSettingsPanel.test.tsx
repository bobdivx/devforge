import { describe, expect, it } from 'vitest';
import {
  cursorKeyProblem,
  cursorKeyWarning,
  installNeeds,
  repoBadge,
  workerSummary,
} from './CursorWorkerSettingsPanel';

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
    expect(workerSummary({ ...ok, running: true, ready: true })).toMatchObject({
      label: 'ON',
      tone: 'ok',
    });
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

describe('invalid / foreign keys', () => {
  it('flags a key refused by Cursor and asks for a new one', () => {
    const s = { ...base, cli_installed: true, api_key_set: true, key_invalid: true };
    expect(workerSummary(s)).toMatchObject({ label: 'Clé KO', tone: 'danger', installed: false });
    expect(installNeeds({ api_key_set: true, key_invalid: true })).toEqual(['api_key']);
  });
  it('rejects keys from other providers client-side', () => {
    expect(cursorKeyProblem('xai-abcdefghijklmnopqrstuvwxyz')).toMatch(/xAI.*pas une clé Cursor/);
    expect(cursorKeyProblem('xai-abcdefghijklmnopqrstuvwxyz')).toMatch(/cursor\.com\/dashboard/);
    expect(cursorKeyProblem('sk-proj-abcdefghijklmnop')).toMatch(/OpenAI/);
    expect(cursorKeyProblem('short')).toMatch(/trop courte/);
    expect(cursorKeyProblem('key_0123456789abcdef')).toBeNull();
    expect(cursorKeyProblem('')).toBeNull();
  });
});

describe('Cursor login (no key)', () => {
  it('does not require a key once logged in', () => {
    expect(installNeeds({ api_key_set: false, logged_in: true })).toEqual([]);
    const s = { ...base, cli_installed: true, logged_in: true };
    expect(workerSummary(s)).toMatchObject({ label: 'Off', installed: true });
  });
  it('warns (without blocking) about grok_ keys', () => {
    const k = 'grok_' + 'a'.repeat(32) + '_' + 'b'.repeat(64);
    expect(cursorKeyProblem(k)).toBeNull();
    expect(cursorKeyWarning(k)).toMatch(/Se connecter avec Cursor/);
    expect(cursorKeyWarning('crsr_0123456789abcdef')).toBeNull();
  });
  it('points a refused grok_ key to the login', () => {
    const s = {
      ...base,
      cli_installed: true,
      api_key_set: true,
      key_invalid: true,
      key_unsupported: true,
    };
    expect(workerSummary(s).detail).toMatch(/grok_/);
  });
});

describe('repoBadge', () => {
  const w = {
    project_uuid: 'u',
    project_name: 'template-studio',
    path: '/data/devforge/applications/u-cursor',
    exists: true,
    has_git: true,
    eligible: true,
  };
  it('montre le dossier -cursor servi, créé au démarrage s’il manque', () => {
    expect(repoBadge({ ...w, worktree_ready: true })).toEqual({ label: 'Servi', tone: 'ok' });
    expect(repoBadge({ ...w, worktree_ready: false }).label).toBe('Créé au démarrage');
  });
  it('signale un projet sans checkout', () => {
    expect(
      repoBadge({
        ...w,
        has_git: false,
        eligible: false,
        note: 'pas encore de checkout : déployer une fois',
      }).label,
    ).toBe('Pas de checkout');
  });
});
