import { fireEvent, render, waitFor } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { GithubMigrationPanel } from './GithubMigrationPanel';

const dry = {
  ok: true,
  dry_run: true,
  migrated: 0,
  not_covered: 1,
  projects: [
    { project_uuid: 'a', name: 'template-studio', status: 'covered' },
    { project_uuid: 'b', name: 'popcornn', status: 'not_covered', repo: 'bobdivx/popcornn' },
  ],
};

describe('GithubMigrationPanel', () => {
  it('dry-run d’abord, migration réelle après confirmation', async () => {
    const githubAppMigrate = vi.fn(async (b: { dry_run: boolean }) =>
      b.dry_run ? dry : { ...dry, dry_run: false, migrated: 1, projects: [{ ...dry.projects[0], migrated: true }, dry.projects[1]] },
    );
    const githubDisconnect = vi.fn(async () => ({ ok: true, connected: false, mode: 'off' }));
    const confirmFn = vi.fn(() => true);
    const r = render(
      <GithubMigrationPanel client={{ githubAppMigrate, githubDisconnect }} confirmFn={confirmFn} />,
    );
    fireEvent.click(r.getByText('Analyser (sans rien modifier)'));
    expect(await r.findByText(/non couvert/)).toBeTruthy();
    expect(githubAppMigrate).toHaveBeenCalledWith({ dry_run: true });
    fireEvent.click(r.getByText('Migrer 1 projet(s)'));
    await waitFor(() => expect(githubAppMigrate).toHaveBeenLastCalledWith({ dry_run: false }));
    expect(confirmFn).toHaveBeenCalled();
    expect(await r.findByText(/template-studio — migré/)).toBeTruthy();
  });

  it('refus de confirmation ⇒ aucun appel réel', async () => {
    const githubAppMigrate = vi.fn(async () => dry);
    const githubDisconnect = vi.fn(async () => ({ ok: true, connected: false, mode: 'off' }));
    const r = render(
      <GithubMigrationPanel client={{ githubAppMigrate, githubDisconnect }} confirmFn={() => false} />,
    );
    fireEvent.click(r.getByText('Analyser (sans rien modifier)'));
    fireEvent.click(await r.findByText('Migrer 1 projet(s)'));
    expect(githubAppMigrate).toHaveBeenCalledTimes(1);
  });

  it('bannière patRemovable ⇒ supprimer le jeton après confirmation', async () => {
    const githubAppMigrate = vi.fn();
    const githubDisconnect = vi.fn(async () => ({ ok: true, connected: false, mode: 'off' }));
    const confirmFn = vi.fn(() => true);
    const onPatCleared = vi.fn();
    const r = render(
      <GithubMigrationPanel
        client={{ githubAppMigrate, githubDisconnect }}
        patRemovable
        confirmFn={confirmFn}
        onPatCleared={onPatCleared}
      />,
    );
    fireEvent.click(r.getByText('Supprimer le jeton'));
    await waitFor(() => expect(githubDisconnect).toHaveBeenCalled());
    expect(confirmFn).toHaveBeenCalled();
    expect(onPatCleared).toHaveBeenCalled();
    expect(await r.findByText(/Jeton personnel supprimé/)).toBeTruthy();
  });
});
