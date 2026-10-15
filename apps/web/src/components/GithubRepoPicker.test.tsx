import { fireEvent, render, waitFor } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import type { AppReposResponse } from '../lib/api';
import { GithubRepoPicker } from './GithubRepoPicker';

const inst = { installation_id: 1, account_login: 'bobdivx', account_type: 'User', suspended: false, configure_url: 'https://github.com/settings/installations/1' };
const repo = (n: string, priv = false) => ({ installation_id: 1, repo_id: n.length, full_name: n, private: priv, default_branch: 'main', html_url: `https://github.com/${n}` });

function client(d: AppReposResponse) {
  return { githubAppRepositories: vi.fn(async () => d) };
}

describe('GithubRepoPicker', () => {
  it('vide → bouton installer', async () => {
    const r = render(<GithubRepoPicker onSelect={() => {}} client={client({ ok: true, installations: [], repositories: [] })} />);
    expect(await r.findByText('Installer l’app GitHub')).toBeTruthy();
  });

  it('recherche, badge privé et sélection', async () => {
    const onSelect = vi.fn();
    const c = client({ ok: true, installations: [inst], repositories: [repo('bobdivx/alpha', true), repo('bobdivx/beta-long')] });
    const r = render(<GithubRepoPicker onSelect={onSelect} client={c} />);
    expect(await r.findByText('bobdivx/alpha')).toBeTruthy();
    expect(r.getByText('privé')).toBeTruthy();
    fireEvent.input(r.getByPlaceholderText('Rechercher un dépôt…'), { target: { value: 'beta' } });
    await waitFor(() => expect(r.queryByText('bobdivx/alpha')).toBeNull());
    fireEvent.click(r.getByText('bobdivx/beta-long'));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ full_name: 'bobdivx/beta-long', installation_id: 1 }));
    fireEvent.click(r.getByText('Actualiser'));
    await waitFor(() => expect(c.githubAppRepositories).toHaveBeenLastCalledWith({ refresh: true }));
  });
});
