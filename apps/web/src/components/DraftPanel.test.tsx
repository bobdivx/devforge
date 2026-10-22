import { render } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import type { DraftStatus } from '../lib/api';
import { DraftDecision, discussionHref, draftHref, originLabel } from './DraftPanel';

function draft(over: Partial<DraftStatus> = {}): DraftStatus {
  return {
    ok: true,
    available: true,
    dirty: true,
    count: 1,
    files: [{ path: 'package-lock.json', status: 'modified' }],
    junk_count: 0,
    branch: 'main',
    ahead: 0,
    behind: 2,
    has_remote: true,
    updated_at: new Date().toISOString(),
    suggested_message: '',
    backups: [],
    preview: { running: false },
    ...over,
  };
}

describe('brouillon : origine et recommandation', () => {
  it('liens directs vers le brouillon et la discussion', () => {
    expect(draftHref('p 1')).toBe('/app/projects/view?uuid=p%201&tab=workspace&draft=1');
    expect(discussionHref('p', { kind: 'repair', agent_uuid: 'a1' })).toBe(
      '/app/projects/view?uuid=p&tab=workspace&view=chat&agent=a1',
    );
    expect(discussionHref('p', { kind: 'manual' })).toBeNull();
    expect(originLabel('repair')).toBe('Réparation · Rustine');
    expect(originLabel('inconnu', true)).toBe('Manuelle');
  });

  it('affiche la recommandation, les faits et le lien « Voir la discussion »', () => {
    const { getByTestId, getByText } = render(
      <DraftDecision
        uuid="p"
        draft={draft({
          origin: { kind: 'repair', agent_uuid: 'a1', agent_name: 'Coordinateur' },
          origin_kinds: ['repair'],
          insight: { behind: 2, overlap: ['package-lock.json'], already_on_github: [] },
          repair_succeeded_at: new Date().toISOString(),
          advice: { level: 'delete', label: 'Conseil · supprimer', reason: 'Une mise en ligne a réussi depuis.' },
        })}
      />,
    );
    expect(getByTestId('draft-advice').textContent).toContain('Conseil · supprimer');
    expect(getByText('Réparation · Rustine')).toBeTruthy();
    expect(getByText(/GitHub a 2 commits de plus/)).toBeTruthy();
    expect(getByText(/Mêmes fichiers touchés sur GitHub : package-lock.json/)).toBeTruthy();
    const link = getByText(/Voir la discussion/).closest('a');
    expect(link?.getAttribute('href')).toContain('agent=a1');
  });
});
