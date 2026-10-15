import { fireEvent, render, waitFor } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import type { GithubAppStatus } from '../lib/api';
import { GithubAppSettingsPanel, submitManifestForm, type GithubAppClient } from './GithubAppSettingsPanel';

const empty: GithubAppStatus = { ok: true, configured: false, required_permissions: {}, installations: [] };

function client(status: GithubAppStatus): GithubAppClient {
  return {
    githubAppStatus: vi.fn(async () => status),
    githubAppManifest: vi.fn(async () => ({
      ok: true,
      post_url: 'https://github.com/settings/apps/new?state=s1',
      manifest: { name: 'DevForgeApp' },
      state: 's1',
    })),
    githubAppForget: vi.fn(async () => ({ ok: true, configured: false })),
  };
}

describe('GithubAppSettingsPanel', () => {
  it('crée le manifest puis le soumet à GitHub', async () => {
    const c = client(empty);
    const submit = vi.fn();
    const r = render(<GithubAppSettingsPanel client={c} submit={submit} />);
    const btn = await r.findByText('Créer l’app GitHub DevForge');
    fireEvent.click(btn);
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(c.githubAppManifest).toHaveBeenCalledWith({});
    expect(submit.mock.calls[0][0].post_url).toContain('/settings/apps/new');
  });

  it('liste les installations et signale les permissions manquantes', async () => {
    const c = client({
      ...empty,
      configured: true,
      slug: 'devforge-nas',
      owner_login: 'bobdivx',
      install_url: 'https://github.com/apps/devforge-nas/installations/new',
      settings_url: 'https://github.com/settings/apps/devforge-nas',
      installations: [
        {
          installation_id: 1,
          account_login: 'bobdivx',
          account_type: 'User',
          repository_selection: 'selected',
          repositories: 3,
          suspended: false,
          permissions: {},
          missing_permissions: ['checks:write'],
        },
      ],
    });
    const r = render(<GithubAppSettingsPanel client={c} />);
    await r.findByText(/3 dépôt\(s\)/);
    expect(r.getByText(/checks:write/)).toBeTruthy();
    expect(r.getByText('Installer sur un autre compte')).toBeTruthy();
    expect(r.getByTestId('app-identity').querySelector('img')?.getAttribute('src')).toBe(
      '/brand/icon-512.png',
    );
    expect(r.getByText('Réglages GitHub').closest('a')?.getAttribute('href')).toBe(
      'https://github.com/settings/apps/devforge-nas',
    );
  });

  it('formulaire caché : POST vers GitHub avec le champ manifest JSON', () => {
    const orig = HTMLFormElement.prototype.submit;
    HTMLFormElement.prototype.submit = vi.fn();
    const f = submitManifestForm({ ok: true, post_url: 'https://github.com/settings/apps/new?state=s', manifest: { a: 1 }, state: 's' });
    expect(f.method).toBe('post');
    expect(f.action).toBe('https://github.com/settings/apps/new?state=s');
    expect((f.querySelector('input[name=manifest]') as HTMLInputElement).value).toBe('{"a":1}');
    HTMLFormElement.prototype.submit = orig;
  });
});
