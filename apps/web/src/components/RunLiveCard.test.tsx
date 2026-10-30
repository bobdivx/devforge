import { fireEvent, render, waitFor } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import type { RunLive } from '../lib/api';

const live: RunLive = {
  run_uuid: 'r1',
  project_uuid: 'p1',
  status: 'completed',
  live: false,
  verdict: 'incomplete',
  status_text: 'Terminé — 1 étape(s) sans résultat',
  playbook: { id: 'deploy-verify', slash: '/deploy-verify', name: 'Déployer & vérifier', rule: 'Un résultat manquant ne compte jamais comme un succès.', visual: 'rocket' },
  steps: [
    { n: 1, label: 'Déployer', state: 'ok' },
    { n: 2, label: 'Vérifier', state: 'ok' },
    { n: 3, label: 'Conclure', state: 'missing' },
  ],
  workers: [],
  counters: { tools_ok: 2, tools_failed: 0, workers_total: 0, workers_done: 0, workers_failed: 0, decisions: 1 },
  decisions: [{ what: 'Déployé', why: 'Commit prêt', evidence: 'https://app.example.org/health', outcome: 'ok', step: 1 }],
};

const wake = vi.fn(async () => ({ data: { ok: true, status: 200, message: 'Bot réveillé (HTTP 200).', event: 'devforge.wake' } }));

vi.mock('../lib/api', () => ({
  api: {
    runLive: vi.fn(async () => ({ data: live })),
    wakeGrokBot: (b: unknown) => wake(b as never),
  },
}));

import { RunLiveCard } from './RunLiveCard';

describe('RunLiveCard', () => {
  it('shows status, steps, rule, journal and wakes the bot', async () => {
    const r = render(<RunLiveCard runUuid="r1" />);
    await r.findByText('Terminé — 1 étape(s) sans résultat');
    expect(r.getByText('Sans résultat')).toBeTruthy();
    expect(r.getByText(/Un résultat manquant/)).toBeTruthy();
    fireEvent.click(r.getByText('Montre-moi ton travail (1)'));
    const link = r.getByText('https://app.example.org/health') as HTMLAnchorElement;
    expect(link.getAttribute('rel')).toContain('noopener');
    fireEvent.click(r.getByText('Réveiller le bot Grok'));
    await waitFor(() => expect(r.getByText('Bot réveillé (HTTP 200).')).toBeTruthy());
    expect(wake).toHaveBeenCalledWith({ project_uuid: 'p1', run_uuid: 'r1' });
  });
});
