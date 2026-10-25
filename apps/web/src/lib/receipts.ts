import type { ApprovalReceipt, ReceiptStatus } from './api';

/** P2 : présentation des reçus d'approbation (fonctions pures, testées). */

export type Tone = 'neutral' | 'accent' | 'ok' | 'warn' | 'danger';

const STATUS: Record<ReceiptStatus, { label: string; tone: Tone }> = {
  done: { label: 'Réussi', tone: 'ok' },
  failed: { label: 'Échec', tone: 'danger' },
  unknown: { label: 'Issue inconnue', tone: 'warn' },
  executing: { label: 'En cours', tone: 'accent' },
  pending: { label: 'En attente', tone: 'neutral' },
  approved: { label: 'Validé', tone: 'accent' },
  expired: { label: 'Expiré', tone: 'neutral' },
};

export function receiptStatus(status: string): { label: string; tone: Tone } {
  return STATUS[status as ReceiptStatus] ?? { label: status, tone: 'neutral' };
}

const SOURCES: Record<string, string> = {
  web: 'Web',
  android: 'Android',
  agent: 'Agent',
  api: 'API',
};

export function receiptSource(source: string): string {
  return SOURCES[source] ?? source;
}

/** Filtres en pastilles : zéro réglage, quatre choix. */
export type ReceiptFilter = 'all' | 'problems' | 'waiting' | 'done';

export const RECEIPT_FILTERS: { key: ReceiptFilter; label: string }[] = [
  { key: 'all', label: 'Tout' },
  { key: 'problems', label: 'À vérifier' },
  { key: 'waiting', label: 'En attente' },
  { key: 'done', label: 'Réussis' },
];

export function filterStatuses(filter: ReceiptFilter): ReceiptStatus[] | undefined {
  switch (filter) {
    case 'problems':
      return ['failed', 'unknown'];
    case 'waiting':
      return ['pending', 'approved', 'executing'];
    case 'done':
      return ['done'];
    default:
      return undefined;
  }
}

/** Version courte : sha → 7 caractères, branche telle quelle. */
export function shortVersion(v?: string | null): string | null {
  const s = (v ?? '').trim();
  if (!s) return null;
  return /^[0-9a-f]{12,40}$/i.test(s) ? s.slice(0, 7) : s;
}

export function formatWhen(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('fr-FR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Paris',
  });
}

/** Sous-titre de tuile : « Projet · par Mathieu ». */
export function receiptSubtitle(r: ApprovalReceipt): string {
  const who = r.approved_by_label?.trim();
  const project = r.project_name?.trim() || r.target;
  return who ? `${project} · par ${who}` : project;
}

/** Validation encore utilisable (pas consommée, non expirée). */
export function approvalLeft(r: ApprovalReceipt, now = Date.now()): number | null {
  if (r.status !== 'approved' && r.status !== 'pending') return null;
  if (!r.expires_at) return null;
  const left = new Date(r.expires_at).getTime() - now;
  if (Number.isNaN(left) || left <= 0) return 0;
  return Math.ceil(left / 60000);
}

/** Lignes du détail (modale), sans champ vide. */
export function receiptDetails(r: ApprovalReceipt): { label: string; value: string }[] {
  const rows: { label: string; value: string | null | undefined }[] = [
    { label: 'Action', value: r.action_label },
    { label: 'Cible', value: r.target },
    { label: 'Projet', value: r.project_name },
    { label: 'Version', value: shortVersion(r.version) },
    { label: 'Validé par', value: r.approved_by_label },
    { label: 'Validé le', value: r.approved_at ? formatWhen(r.approved_at) : null },
    { label: 'Depuis', value: receiptSource(r.source) },
    { label: 'Lancé le', value: r.consumed_at ? formatWhen(r.consumed_at) : null },
    { label: 'Terminé le', value: r.finished_at ? formatWhen(r.finished_at) : null },
    { label: 'Outil', value: r.tool_name },
    { label: 'Empreinte', value: r.action_hash ? r.action_hash.slice(0, 12) : null },
  ];
  return rows.filter((x): x is { label: string; value: string } => !!x.value && x.value.trim() !== '');
}
