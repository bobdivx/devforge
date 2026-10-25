import { describe, expect, it } from 'vitest';
import type { PageWatch } from './api';
import {
  alertsBadge,
  checkOutcome,
  emptyForm,
  formFromWatch,
  formToInput,
  hostOf,
  nextCheckLabel,
  normalizeUrl,
  parseAmount,
  watchCondition,
  watchDetails,
  watchStatus,
} from './watches';

function watch(over: Partial<PageWatch> = {}): PageWatch {
  return {
    uuid: 'w1',
    workspace_uuid: 'ws',
    name: 'exemple.fr',
    url: 'https://www.exemple.fr/produit',
    kind: 'change',
    interval_minutes: 60,
    status: 'active',
    failure_streak: 0,
    next_check_at: new Date(Date.now() + 30 * 60000).toISOString(),
    last_check_at: new Date().toISOString(),
    condition_met: false,
    alert_seq: 0,
    created_at: '2026-10-25T10:00:00Z',
    updated_at: '2026-10-25T10:00:00Z',
    ...over,
  };
}

describe('watchStatus', () => {
  it('distingue pause, erreurs, première lecture et condition', () => {
    expect(watchStatus(watch({ status: 'paused', paused_reason: 'failures' })).tone).toBe('danger');
    expect(watchStatus(watch({ status: 'paused', paused_reason: 'user' })).label).toBe('En pause');
    expect(watchStatus(watch({ failure_streak: 2 })).label).toBe('Erreur 2/5');
    expect(watchStatus(watch({ last_check_at: null })).label).toBe('Première lecture…');
    expect(watchStatus(watch({ kind: 'text', needle: 'x', condition_met: true })).label).toBe('Condition remplie');
    expect(watchStatus(watch()).label).toBe('Surveillée');
  });
});

describe('watchCondition', () => {
  it('décrit chaque type', () => {
    expect(watchCondition(watch())).toBe('Tout changement du texte');
    expect(watchCondition(watch({ kind: 'text', needle: 'En stock' }))).toBe('« En stock » apparaît');
    expect(watchCondition(watch({ kind: 'text', needle: 'Rupture', text_mode: 'disappears' }))).toBe(
      '« Rupture » disparaît',
    );
    expect(watchCondition(watch({ kind: 'price', threshold: 99.9, currency: 'EUR' }))).toMatch(/^Prix ≤ 99,90\s€$/);
    expect(watchCondition(watch({ kind: 'price', price_op: 'above', threshold: 20, currency: 'USD' }))).toBe('Prix ≥ $20');
  });
});

describe('formulaire', () => {
  it('ajoute https et exige le texte ou le seuil', () => {
    expect(normalizeUrl('exemple.fr/a')).toBe('https://exemple.fr/a');
    expect(normalizeUrl('http://x.fr')).toBe('http://x.fr');
    const base = emptyForm();
    expect(formToInput({ ...base, url: '' }).ok).toBe(false);
    expect(formToInput({ ...base, url: 'ftp://x.fr' }).ok).toBe(false);
    expect(formToInput({ ...base, url: 'exemple.fr', kind: 'text' }).ok).toBe(false);
    expect(formToInput({ ...base, url: 'exemple.fr', kind: 'price', threshold: 'abc' }).ok).toBe(false);
    const r = formToInput({ ...base, url: 'exemple.fr', kind: 'price', threshold: '1 299,90' });
    expect(r).toEqual({
      ok: true,
      input: {
        url: 'https://exemple.fr',
        kind: 'price',
        interval_minutes: 60,
        threshold: 1299.9,
        price_op: 'below',
        currency: 'EUR',
      },
    });
  });

  it('relit une surveillance existante', () => {
    const f = formFromWatch(watch({ kind: 'price', threshold: 12.5, price_op: 'above', currency: 'CHF' }));
    expect(f.threshold).toBe('12,5');
    expect(f.price_op).toBe('above');
    expect(parseAmount(f.threshold)).toBe(12.5);
    expect(parseAmount('1.299,00 €')).toBe(1299);
    expect(parseAmount('')).toBeNull();
  });
});

describe('détails', () => {
  it('formate hôte, prochaine lecture et issues', () => {
    expect(hostOf('https://www.exemple.fr/a')).toBe('exemple.fr');
    const now = Date.now();
    expect(nextCheckLabel(watch({ next_check_at: new Date(now + 12 * 60000).toISOString() }), now)).toBe('dans 12 min');
    expect(nextCheckLabel(watch({ status: 'paused' }), now)).toBe('—');
    expect(checkOutcome({ outcome: 'error' }).tone).toBe('danger');
    const rows = watchDetails(watch());
    expect(rows.find((r) => r.label === 'Fréquence')?.value).toBe('Toutes les 1 h');
    expect(rows.some((r) => r.label === 'Dernière valeur')).toBe(false);
  });
});

describe('alertsBadge', () => {
  it('plafonne à 9+', () => {
    expect(alertsBadge(0)).toBe('');
    expect(alertsBadge(3)).toBe('3');
    expect(alertsBadge(12)).toBe('9+');
  });
});
