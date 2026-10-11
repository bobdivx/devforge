import { act, fireEvent, render, waitFor } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import type { MemoryItem, MemoryList } from '../lib/api';
import { budgetState, relativeAgo, relativeUntil, scopeLabel, sourceLabel } from '../lib/memory-ui';
import { draftStatusText } from './DraftPanel';
import { MemorySettingsPanel, type MemoryClient } from './MemorySettingsPanel';
import { ToastProvider } from './ui';

const NOW = Date.parse('2026-10-11T10:00:00Z');

function item(over: Partial<MemoryItem> = {}): MemoryItem {
  return {
    uuid: 'm1',
    scope: 'user',
    tier: 'profile',
    kind: 'preference',
    content: 'Préfère des réponses courtes.',
    source: 'user_said',
    confidence: 1,
    inferred: false,
    pinned: false,
    created_by: 'user',
    created_at: '2026-10-11T08:00:00Z',
    updated_at: '2026-10-11T08:00:00Z',
    versions: 0,
    ...over,
  };
}

function fakeClient(items: MemoryItem[]): MemoryClient & { calls: string[] } {
  let store = [...items];
  const calls: string[] = [];
  const list = (): MemoryList => ({ ok: true, items: store, has_more: false, profile_budget: { used: 300, max: 1500 } });
  return {
    calls,
    memoryList: vi.fn(async (p: { tier?: string } = {}) => {
      calls.push(`list:${p.tier}`);
      return { ...list(), items: store.filter((i) => !p.tier || i.tier === p.tier) };
    }),
    memoryCreate: vi.fn(async (b) => {
      calls.push(`create:${b.content}`);
      store = [item({ uuid: 'new', content: b.content }), ...store];
      return { ok: true, outcome: 'inserted', uuid: 'new' };
    }),
    memoryCorrect: vi.fn(async (uuid: string, content: string) => {
      calls.push(`correct:${uuid}:${content}`);
      store = store.map((i) => (i.uuid === uuid ? { ...i, uuid: 'v2', content, versions: 1 } : i));
      return { ok: true, outcome: 'superseded', uuid: 'v2' };
    }),
    memoryForget: vi.fn(async (uuid: string) => {
      calls.push(`forget:${uuid}`);
      store = store.filter((i) => i.uuid !== uuid);
      return { ok: true, forgotten: 1 };
    }),
    memoryPin: vi.fn(async (uuid: string, pinned: boolean) => {
      calls.push(`pin:${uuid}:${pinned}`);
      store = store.map((i) => (i.uuid === uuid ? { ...i, pinned } : i));
      return { ok: true, pinned };
    }),
    memoryHistory: vi.fn(async () => ({ ok: true, items: [item({ uuid: 'old', content: 'Ancienne version' })] })),
    memoryEraseAll: vi.fn(async () => {
      calls.push('erase');
      const n = store.length;
      store = [];
      return { ok: true, erased: n };
    }),
  } as unknown as MemoryClient & { calls: string[] };
}

function mount(client: MemoryClient) {
  return render(
    <ToastProvider>
      <MemorySettingsPanel client={client} />
    </ToastProvider>,
  );
}

describe('memory-ui', () => {
  it('dates relatives et expirations', () => {
    expect(relativeAgo('2026-10-11T08:00:00Z', NOW)).toBe('il y a 2 h');
    expect(relativeAgo('2026-10-11T09:59:40Z', NOW)).toBe('à l’instant');
    expect(relativeUntil('2026-10-13T10:00:00Z', NOW)).toBe('expire dans 2 j');
    expect(relativeUntil('2026-10-11T09:00:00Z', NOW)).toBe('expirée');
  });

  it('sources et portées lisibles', () => {
    expect(sourceLabel(item()).text).toBe('dit par toi');
    expect(sourceLabel(item({ source: 'observed', created_by: 'agent:a1', created_by_name: 'Coordinateur', inferred: true })).text).toBe(
      'déduit par Coordinateur',
    );
    expect(sourceLabel(item({ source: 'system', created_by: 'system' })).text).toBe('noté par DevForge');
    expect(scopeLabel(item())).toBe('Toutes tes apps');
    expect(scopeLabel(item({ scope: 'project', project_name: 'template-studio' }))).toBe('template-studio');
  });

  it('budget du profil', () => {
    expect(budgetState(300, 1500)).toEqual({ pct: 20, tone: 'ok' });
    expect(budgetState(1400, 1500).tone).toBe('warn');
    expect(budgetState(1700, 1500)).toEqual({ pct: 100, tone: 'danger' });
  });
});

describe('MemorySettingsPanel', () => {
  it('affiche le profil, le budget et la source', async () => {
    const client = fakeClient([item(), item({ uuid: 'm2', content: 'Le site est en Astro.', source: 'observed', created_by: 'agent:a', inferred: true, scope: 'project', project_name: 'esp' })]);
    const { findAllByTestId, getByTestId, getByText } = mount(client);
    expect((await findAllByTestId('memory-row')).length).toBe(2);
    expect(getByTestId('memory-budget').textContent).toContain('300 / 1');
    expect(getByText('dit par toi')).toBeTruthy();
    expect(getByText('déduit par Braise')).toBeTruthy();
    expect(getByText('esp')).toBeTruthy();
  });

  it('corrige, épingle et oublie (repli animé puis retrait)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const client = fakeClient([item()]);
    const { findAllByTestId, getByText, getByLabelText, queryAllByTestId } = mount(client);
    await findAllByTestId('memory-row');
    fireEvent.click(getByText('Corriger'));
    fireEvent.input(getByLabelText('Corriger le souvenir'), { target: { value: 'Préfère des réponses détaillées.' } });
    await act(async () => {
      fireEvent.click(getByText('Enregistrer'));
    });
    await waitFor(() => expect(getByText('Préfère des réponses détaillées.')).toBeTruthy());
    expect(client.calls).toContain('correct:m1:Préfère des réponses détaillées.');
    // Historique des versions dépliable.
    await act(async () => {
      fireEvent.click(getByText('Versions précédentes'));
    });
    await waitFor(() => expect(getByText('Ancienne version')).toBeTruthy());
    await act(async () => {
      fireEvent.click(getByText('Épingler'));
    });
    expect(client.calls).toContain('pin:v2:true');
    await act(async () => {
      fireEvent.click(getByText('Oublier'));
    });
    const row = (await findAllByTestId('memory-row'))[0];
    expect(row.getAttribute('data-open')).toBe('false');
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    await waitFor(() => expect(queryAllByTestId('memory-row').length).toBe(0));
    vi.useRealTimers();
  });

  it('ajoute un souvenir et change d’onglet', async () => {
    const client = fakeClient([]);
    const { findByTestId, getByText, getByLabelText, getByRole } = mount(client);
    await findByTestId('memory-empty');
    fireEvent.click(getByText('Ajouter'));
    fireEvent.input(getByLabelText('Nouveau souvenir (toutes tes apps)'), { target: { value: 'Répond en français.' } });
    await act(async () => {
      fireEvent.submit(getByText('Ajouter', { selector: 'button[type=submit]' }).closest('form')!);
    });
    expect(client.calls).toContain('create:Répond en français.');
    await act(async () => {
      fireEvent.click(getByRole('tab', { name: 'Journal' }));
    });
    expect(getByRole('tab', { name: 'Journal' }).getAttribute('aria-selected')).toBe('true');
    await waitFor(() => expect(client.calls).toContain('list:log'));
  });

  it('« Tout effacer » demande confirmation', async () => {
    const client = fakeClient([item()]);
    const { findAllByTestId, getAllByText } = mount(client);
    await findAllByTestId('memory-row');
    fireEvent.click(getAllByText('Tout effacer')[0]);
    expect(client.calls).not.toContain('erase');
    const buttons = getAllByText('Tout effacer');
    await act(async () => {
      fireEvent.click(buttons[buttons.length - 1]);
    });
    expect(client.calls).toContain('erase');
  });
});

describe('ligne d’état du brouillon (en-tête du chat)', () => {
  it('brouillon modifié / supprimé / rien', () => {
    const base = { available: true, dirty: true, count: 2, behind: 0, backups: [] } as never;
    expect(draftStatusText(base)).toEqual({ text: 'Brouillon · 2 fichiers modifiés', tone: 'warn' });
    expect(draftStatusText({ available: true, dirty: false, count: 0, behind: 0, backups: [{}] } as never)?.tone).toBe('muted');
    expect(draftStatusText({ available: true, dirty: false, count: 0, behind: 0, backups: [] } as never)).toBeNull();
    expect(draftStatusText(null)).toBeNull();
  });
});
