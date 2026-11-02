import { fireEvent, render, waitFor } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AutonomousPublish } from '../lib/api';

const get = vi.fn<(uuid: string) => Promise<{ data: AutonomousPublish }>>();
const put = vi.fn<
  (uuid: string, enabled: boolean) => Promise<{ ok: boolean; message: string; data: AutonomousPublish }>
>();

vi.mock('../lib/api', () => ({
  api: {
    autonomousPublish: (uuid: string) => get(uuid),
    setAutonomousPublish: (uuid: string, enabled: boolean) => put(uuid, enabled),
  },
}));

import { AutonomousPublishPanel, formatEnabledAt } from './AutonomousPublishPanel';

describe('AutonomousPublishPanel', () => {
  beforeEach(() => {
    get.mockReset();
    put.mockReset();
  });

  it('is off by default and an admin can turn it on', async () => {
    get.mockResolvedValue({ data: { enabled: false, can_edit: true } });
    put.mockResolvedValue({
      ok: true,
      message: 'Publication autonome activée',
      data: { enabled: true, can_edit: true, enabled_by_label: 'Mathieu', enabled_at: '2026-11-02T17:00:00Z' },
    });
    const r = render(<AutonomousPublishPanel projectUuid="p1" />);
    const sw = await r.findByRole('switch', { name: 'Publication autonome' });
    expect(sw.getAttribute('aria-checked')).toBe('false');
    expect(r.getByText('Désactivée')).toBeTruthy();
    fireEvent.click(sw);
    await waitFor(() => expect(put).toHaveBeenCalledWith('p1', true));
    await waitFor(() => expect(sw.getAttribute('aria-checked')).toBe('true'));
    expect(r.getByText(/Activée par Mathieu le 02\/11\/2026 18:00/)).toBeTruthy();
  });

  it('cannot be changed without admin rights', async () => {
    get.mockResolvedValue({ data: { enabled: false, can_edit: false } });
    const r = render(<AutonomousPublishPanel projectUuid="p1" />);
    const sw = await r.findByRole('switch', { name: 'Publication autonome' });
    expect((sw as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(sw);
    expect(put).not.toHaveBeenCalled();
    expect(r.getByText(/Seul un admin/)).toBeTruthy();
  });

  it('formats the date in Paris time', () => {
    expect(formatEnabledAt('2026-07-01T10:30:00Z')).toBe('01/07/2026 12:30');
    expect(formatEnabledAt(null)).toBe('');
  });
});
