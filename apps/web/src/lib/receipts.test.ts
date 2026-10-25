import { describe, expect, it } from 'vitest';
import type { ApprovalReceipt } from './api';
import {
  approvalLeft,
  filterStatuses,
  receiptDetails,
  receiptStatus,
  receiptSubtitle,
  shortVersion,
} from './receipts';

function receipt(over: Partial<ApprovalReceipt> = {}): ApprovalReceipt {
  return {
    uuid: 'r1',
    project_uuid: 'p1',
    project_name: 'Site vitrine',
    action: 'stop',
    action_label: 'Arrêter',
    target: 'Site vitrine',
    version: 'main',
    action_hash: 'abcdef0123456789',
    status: 'done',
    source: 'web',
    approved_by_label: 'Mathieu',
    approved_at: '2026-10-25T10:00:00Z',
    created_at: '2026-10-25T10:00:00Z',
    updated_at: '2026-10-25T10:00:00Z',
    ...over,
  };
}

describe('reçus d’approbation', () => {
  it('donne un libellé et un ton à chaque issue', () => {
    expect(receiptStatus('done')).toEqual({ label: 'Réussi', tone: 'ok' });
    expect(receiptStatus('failed').tone).toBe('danger');
    expect(receiptStatus('unknown').label).toBe('Issue inconnue');
    expect(receiptStatus('bizarre')).toEqual({ label: 'bizarre', tone: 'neutral' });
  });

  it('traduit les pastilles en filtres serveur', () => {
    expect(filterStatuses('all')).toBeUndefined();
    expect(filterStatuses('problems')).toEqual(['failed', 'unknown']);
    expect(filterStatuses('done')).toEqual(['done']);
  });

  it('raccourcit un commit mais garde une branche', () => {
    expect(shortVersion('0123456789abcdef0123')).toBe('0123456');
    expect(shortVersion('main')).toBe('main');
    expect(shortVersion('  ')).toBeNull();
  });

  it('résume qui a validé', () => {
    expect(receiptSubtitle(receipt())).toBe('Site vitrine · par Mathieu');
    expect(receiptSubtitle(receipt({ approved_by_label: null, project_name: null }))).toBe('Site vitrine');
  });

  it('compte les minutes restantes d’une validation', () => {
    const now = Date.parse('2026-10-25T10:00:00Z');
    expect(approvalLeft(receipt(), now)).toBeNull();
    expect(approvalLeft(receipt({ status: 'approved', expires_at: '2026-10-25T10:29:30Z' }), now)).toBe(30);
    expect(approvalLeft(receipt({ status: 'pending', expires_at: '2026-10-25T09:00:00Z' }), now)).toBe(0);
  });

  it('n’affiche pas les champs vides dans le détail', () => {
    const rows = receiptDetails(receipt({ tool_name: null, finished_at: null }));
    const labels = rows.map((r) => r.label);
    expect(labels).toContain('Validé par');
    expect(labels).not.toContain('Outil');
    expect(labels).not.toContain('Terminé le');
    expect(rows.find((r) => r.label === 'Empreinte')?.value).toBe('abcdef012345');
  });
});
