import { fireEvent, render, waitFor } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import type { PreviewsResponse } from '../lib/api';
import { ProjectPreviewsPanel, type PreviewsClient } from './ProjectPreviewsPanel';

function client(data: PreviewsResponse): PreviewsClient {
  return {
    projectPreviews: vi.fn(async () => data),
    setProjectPreviews: vi.fn(async (_u, enabled) => ({ ok: true, enabled })),
    redeployPreview: vi.fn(async () => ({ ok: true })),
    deletePreview: vi.fn(async () => ({ ok: true })),
  };
}

const base: PreviewsResponse = { ok: true, enabled: true, linked: true, previews: [] };

describe('ProjectPreviewsPanel', () => {
  it('état vide', async () => {
    const r = render(<ProjectPreviewsPanel uuid="p" client={client(base)} />);
    expect(await r.findByText('Aucune preview pour l’instant.')).toBeTruthy();
  });

  it('liste, redéploie et supprime', async () => {
    const c = client({
      ...base,
      previews: [{ pr_number: 4, head_sha: '0123456789', status: 'ready', url: 'https://pr-4-x.jeser.app', updated_at: '' }],
    });
    const r = render(<ProjectPreviewsPanel uuid="p" client={c} />);
    expect(await r.findByText('https://pr-4-x.jeser.app')).toBeTruthy();
    fireEvent.click(r.getByText('Redéployer'));
    await waitFor(() => expect(c.redeployPreview).toHaveBeenCalledWith('p', 4));
    fireEvent.click(r.getByText('Supprimer'));
    await waitFor(() => expect(c.deletePreview).toHaveBeenCalledWith('p', 4));
  });

  it('bascule et signale un projet non relié', async () => {
    const c = client({ ...base, linked: false });
    const r = render(<ProjectPreviewsPanel uuid="p" client={c} />);
    const box = (await r.findByRole('checkbox')) as HTMLInputElement;
    expect(r.getByText(/pas encore relié/)).toBeTruthy();
    fireEvent.change(box, { target: { checked: false } });
    await waitFor(() => expect(c.setProjectPreviews).toHaveBeenCalledWith('p', false));
  });
});
