import type { MemoryItem, MemoryTier } from './api';

/** Libellés français des types de souvenir. */
export const KIND_LABELS: Record<string, string> = {
  fact: 'Fait',
  preference: 'Préférence',
  infra: 'Infra',
  decision: 'Décision',
  incident: 'Incident',
  todo: 'À faire',
  context: 'Contexte',
};

export const TIER_TABS: { key: MemoryTier; label: string; hint: string }[] = [
  {
    key: 'profile',
    label: 'Profil',
    hint: 'Toujours lu par tes agents : préférences, machines, conventions.',
  },
  { key: 'log', label: 'Journal', hint: 'Décisions, incidents et déploiements datés. Retrouvés quand c’est utile.' },
  { key: 'note', label: 'Notes', hint: 'Contexte court d’un fil (« déjà tenté », hypothèses). Expire tout seul.' },
];

export function relativeAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const min = Math.round(Math.max(0, now - t) / 60000);
  if (min < 1) return 'à l’instant';
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `il y a ${h} h`;
  return `il y a ${Math.round(h / 24)} j`;
}

export function relativeUntil(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const min = Math.round((t - now) / 60000);
  if (min <= 0) return 'expirée';
  if (min < 60) return `expire dans ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `expire dans ${h} h`;
  return `expire dans ${Math.round(h / 24)} j`;
}

/** « dit par toi » / « déduit par Braise » / « noté par DevForge ». */
export function sourceLabel(item: Pick<MemoryItem, 'source' | 'created_by' | 'created_by_name' | 'inferred'>): {
  text: string;
  tone: 'user' | 'agent' | 'system';
} {
  if (item.created_by === 'user' || (item.source === 'user_said' && !item.created_by.startsWith('agent'))) {
    return { text: 'dit par toi', tone: 'user' };
  }
  if (item.created_by === 'system' || item.source === 'system') return { text: 'noté par DevForge', tone: 'system' };
  const who = item.created_by_name || 'Braise';
  if (item.source === 'user_said') return { text: `retenu par ${who} (tu l’as dit)`, tone: 'user' };
  return { text: `${item.inferred ? 'déduit' : 'noté'} par ${who}`, tone: 'agent' };
}

export function scopeLabel(item: Pick<MemoryItem, 'scope' | 'project_name' | 'agent_name'>): string {
  if (item.scope === 'user') return 'Toutes tes apps';
  if (item.scope === 'project') return item.project_name || 'Une app';
  return item.agent_name ? `Fil · ${item.agent_name}` : 'Un fil';
}

/** Part du budget du profil utilisée (0–100) et ton de la barre. */
export function budgetState(used: number, max: number): { pct: number; tone: 'ok' | 'warn' | 'danger' } {
  const pct = max > 0 ? Math.min(100, Math.round((used / max) * 100)) : 0;
  return { pct, tone: used > max ? 'danger' : pct >= 85 ? 'warn' : 'ok' };
}
