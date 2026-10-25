import type { PageWatch, WatchCheck, WatchInput, WatchKind } from './api';
import { formatWhen } from './receipts';

/** P3 : présentation de la surveillance de page (fonctions pures, testées). */

export type Tone = 'neutral' | 'accent' | 'ok' | 'warn' | 'danger';

export const MAX_FAILURES = 5;

export const KINDS: { key: WatchKind; label: string; hint: string }[] = [
  { key: 'change', label: 'Changement', hint: 'Prévenir quand le texte de la page change.' },
  { key: 'text', label: 'Texte', hint: 'Prévenir quand un texte apparaît ou disparaît.' },
  { key: 'price', label: 'Prix', hint: 'Prévenir quand un prix passe sous ou au-dessus d’un seuil.' },
];

export const INTERVALS: { minutes: number; label: string }[] = [
  { minutes: 15, label: '15 min' },
  { minutes: 30, label: '30 min' },
  { minutes: 60, label: '1 h' },
  { minutes: 180, label: '3 h' },
  { minutes: 360, label: '6 h' },
  { minutes: 720, label: '12 h' },
  { minutes: 1440, label: '24 h' },
];

export const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF'] as const;

const SYMBOL: Record<string, string> = { EUR: '€', USD: '$', GBP: '£', CHF: 'CHF' };

export function intervalLabel(minutes: number): string {
  return INTERVALS.find((i) => i.minutes === minutes)?.label ?? `${minutes} min`;
}

export function formatAmount(v: number, currency = 'EUR'): string {
  const n = v.toLocaleString('fr-FR', { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 });
  const sym = SYMBOL[currency] ?? currency;
  return currency === 'USD' || currency === 'GBP' ? `${sym}${n}` : `${n} ${sym}`;
}

/** Ce qui est guetté, en une ligne. */
export function watchCondition(w: Pick<PageWatch, 'kind' | 'needle' | 'text_mode' | 'price_op' | 'threshold' | 'currency'>): string {
  if (w.kind === 'text') {
    const t = `« ${w.needle ?? ''} »`;
    return w.text_mode === 'disappears' ? `${t} disparaît` : `${t} apparaît`;
  }
  if (w.kind === 'price') {
    const op = w.price_op === 'above' ? '≥' : '≤';
    return `Prix ${op} ${formatAmount(w.threshold ?? 0, w.currency ?? 'EUR')}`;
  }
  return 'Tout changement du texte';
}

/** État affiché sur la tuile : une étiquette, une couleur. */
export function watchStatus(w: PageWatch): { label: string; tone: Tone } {
  if (w.status === 'paused') {
    return w.paused_reason === 'failures'
      ? { label: 'En pause · page injoignable', tone: 'danger' }
      : { label: 'En pause', tone: 'neutral' };
  }
  if (w.failure_streak > 0) return { label: `Erreur ${w.failure_streak}/${MAX_FAILURES}`, tone: 'warn' };
  if (!w.last_check_at) return { label: 'Première lecture…', tone: 'accent' };
  if (w.kind !== 'change' && w.condition_met) return { label: 'Condition remplie', tone: 'ok' };
  return { label: 'Surveillée', tone: 'ok' };
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** Sous-titre de tuile : dernière valeur lue ou condition. */
export function watchSubtitle(w: PageWatch): string {
  if (w.kind === 'price' && w.last_value) return `${w.last_value} · ${watchCondition(w)}`;
  return watchCondition(w);
}

const OUTCOMES: Record<string, { label: string; tone: Tone }> = {
  baseline: { label: 'Référence', tone: 'neutral' },
  unchanged: { label: 'Sans changement', tone: 'neutral' },
  changed: { label: 'Changement', tone: 'accent' },
  met: { label: 'Condition remplie', tone: 'ok' },
  not_met: { label: 'Pas encore', tone: 'neutral' },
  error: { label: 'Erreur', tone: 'danger' },
};

export function checkOutcome(c: Pick<WatchCheck, 'outcome'>): { label: string; tone: Tone } {
  return OUTCOMES[c.outcome] ?? { label: c.outcome, tone: 'neutral' };
}

/** « dans 12 min », « maintenant », ou date. */
export function nextCheckLabel(w: PageWatch, now = Date.now()): string {
  if (w.status !== 'active') return '—';
  const t = new Date(w.next_check_at).getTime();
  if (Number.isNaN(t)) return '—';
  const min = Math.round((t - now) / 60000);
  if (min <= 1) return 'dans une minute';
  if (min < 60) return `dans ${min} min`;
  if (min < 24 * 60) return `dans ${Math.round(min / 60)} h`;
  return formatWhen(w.next_check_at);
}

export type WatchForm = {
  name: string;
  url: string;
  kind: WatchKind;
  text: string;
  text_mode: 'appears' | 'disappears';
  price_op: 'below' | 'above';
  threshold: string;
  currency: string;
  interval_minutes: number;
};

export function emptyForm(): WatchForm {
  return {
    name: '',
    url: '',
    kind: 'change',
    text: '',
    text_mode: 'appears',
    price_op: 'below',
    threshold: '',
    currency: 'EUR',
    interval_minutes: 60,
  };
}

export function formFromWatch(w: PageWatch): WatchForm {
  return {
    name: w.name,
    url: w.url,
    kind: (['change', 'text', 'price'].includes(w.kind) ? w.kind : 'change') as WatchKind,
    text: w.needle ?? '',
    text_mode: w.text_mode === 'disappears' ? 'disappears' : 'appears',
    price_op: w.price_op === 'above' ? 'above' : 'below',
    threshold: w.threshold != null ? String(w.threshold).replace('.', ',') : '',
    currency: w.currency ?? 'EUR',
    interval_minutes: w.interval_minutes,
  };
}

/** « 1 299,90 » → 1299.9 ; vide ou invalide → null. */
export function parseAmount(raw: string): number | null {
  const s = raw.replace(/[\s\u00a0\u202f€$£]/g, '').replace(/chf/i, '');
  if (!s) return null;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  let norm = s;
  if (lastComma >= 0 && lastDot >= 0) {
    norm = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lastComma >= 0) {
    norm = s.replace(',', '.');
  }
  const v = Number(norm);
  return Number.isFinite(v) && v >= 0 ? v : null;
}

/** Ajoute https:// si l'adresse n'a pas de schéma (zéro config). */
export function normalizeUrl(raw: string): string {
  const s = raw.trim();
  if (!s) return s;
  return /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`;
}

/** Valide le formulaire ; renvoie le corps de requête ou un message. */
export function formToInput(f: WatchForm): { ok: true; input: WatchInput } | { ok: false; error: string } {
  const url = normalizeUrl(f.url);
  if (!url) return { ok: false, error: 'Indique l’adresse de la page.' };
  if (!/^https?:\/\//i.test(url)) return { ok: false, error: 'Seules les adresses http et https sont acceptées.' };
  const input: WatchInput = { url, kind: f.kind, interval_minutes: f.interval_minutes };
  if (f.name.trim()) input.name = f.name.trim();
  if (f.kind === 'text') {
    if (!f.text.trim()) return { ok: false, error: 'Indique le texte à guetter.' };
    input.text = f.text.trim();
    input.text_mode = f.text_mode;
  }
  if (f.kind === 'price') {
    const t = parseAmount(f.threshold);
    if (t === null) return { ok: false, error: 'Indique le seuil de prix.' };
    input.threshold = t;
    input.price_op = f.price_op;
    input.currency = f.currency;
    if (f.text.trim()) input.text = f.text.trim();
  }
  return { ok: true, input };
}

/** Lignes du détail (modale), sans champ vide. */
export function watchDetails(w: PageWatch): { label: string; value: string }[] {
  const rows: { label: string; value: string | null | undefined }[] = [
    { label: 'Guette', value: watchCondition(w) },
    { label: 'Dernière valeur', value: w.kind === 'change' ? null : w.last_value },
    { label: 'Fréquence', value: `Toutes les ${intervalLabel(w.interval_minutes)}` },
    { label: 'Dernière lecture', value: w.last_check_at ? formatWhen(w.last_check_at) : 'Pas encore' },
    { label: 'Prochaine', value: w.status === 'active' ? nextCheckLabel(w) : null },
    { label: 'Dernière alerte', value: w.last_alert_at ? formatWhen(w.last_alert_at) : null },
  ];
  return rows.filter((x): x is { label: string; value: string } => !!x.value && x.value.trim() !== '');
}

export { formatWhen };

/** Pastille d'en-tête : « 3 », plafonnée à « 9+ ». */
export function alertsBadge(n: number): string {
  if (n <= 0) return '';
  return n > 9 ? '9+' : String(n);
}
