import { render, waitFor } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import type { WakeLogEntry } from '../lib/api';
import { WakeLogPanel, outcomeMeta } from './WakeLogPanel';

const row = (over: Partial<WakeLogEntry>): WakeLogEntry => ({
  id: 1, source: 'routine', key: 'routine:1', label: 'Veille', outcome: 'done', cause: 'premier passage',
  state_hash: 'abcdef1234567890', run_uuid: null, repeat: 1, created_at: '2026-10-13T08:00:00Z', last_at: '2026-10-13T08:00:00Z', ...over,
});

describe('WakeLogPanel', () => {
  it('libellés des issues', () => {
    expect(outcomeMeta({ outcome: 'skipped', repeat: 11 }).label).toBe('Ignoré ×11');
    expect(outcomeMeta({ outcome: 'skipped', repeat: 1 }).label).toBe('Ignoré');
    expect(outcomeMeta({ outcome: 'failed', repeat: 1 }).label).toBe('Échec');
    expect(outcomeMeta({ outcome: 'launched', repeat: 1 }).label).toBe('Lancé');
  });
  it('affiche un historique compact', async () => {
    const client = { wakeLog: vi.fn(async () => ({ data: [row({ id: 2, outcome: 'skipped', repeat: 11, cause: 'état inchangé' }), row({})] })) };
    const v = render(<WakeLogPanel projectUuid="p1" client={client} />);
    await waitFor(() => expect(v.getByText('Ignoré ×11')).toBeTruthy());
    expect(v.getByText('Terminé')).toBeTruthy();
    expect(v.getAllByText('abcdef1').length).toBe(2);
    expect(client.wakeLog).toHaveBeenCalledWith('p1', 30);
  });
  it('état vide', async () => {
    const v = render(<WakeLogPanel projectUuid="p1" client={{ wakeLog: async () => ({ data: [] }) }} />);
    await waitFor(() => expect(v.getByText("Aucun réveil automatique pour l'instant.")).toBeTruthy());
  });
});
