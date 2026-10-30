import type { RunDecision, RunLive, StepState } from './api';

/** Rythme du sondage de la carte live (ms). */
export const LIVE_POLL_MS = 2500;

export const STEP_LABEL: Record<StepState, string> = {
  pending: 'À venir',
  running: 'En cours',
  ok: 'OK',
  failed: 'Échec',
  skipped: 'Ignorée',
  missing: 'Sans résultat',
};

export type Tone = 'accent' | 'ok' | 'danger' | 'warn' | 'muted';

export function stepTone(state: StepState | string): Tone {
  switch (state) {
    case 'ok':
      return 'ok';
    case 'failed':
      return 'danger';
    case 'missing':
      return 'warn';
    case 'running':
      return 'accent';
    default:
      return 'muted';
  }
}

export function workerState(status: string): StepState {
  if (status === 'completed') return 'ok';
  if (status === 'failed' || status === 'cancelled') return 'failed';
  if (status === 'running') return 'running';
  return 'pending';
}

export const VERDICT_LABEL: Record<string, string> = {
  running: 'En cours',
  ok: 'Réussi',
  failed: 'Échec',
  incomplete: 'Incomplet',
};

export function verdictTone(v: string): Tone {
  if (v === 'ok') return 'ok';
  if (v === 'failed') return 'danger';
  if (v === 'incomplete') return 'warn';
  return 'accent';
}

/** Pastilles compteurs : seules les valeurs utiles (jamais « 0 échec » inutile). */
export function counterPills(live: Pick<RunLive, 'counters'>): Array<{ key: string; label: string; tone: Tone }> {
  const c = live.counters;
  const pills: Array<{ key: string; label: string; tone: Tone }> = [];
  if (c.workers_total > 0) {
    pills.push({
      key: 'workers',
      label: `Workers ${c.workers_done}/${c.workers_total}`,
      tone: c.workers_failed > 0 ? 'danger' : c.workers_done === c.workers_total ? 'ok' : 'accent',
    });
  }
  pills.push({ key: 'tools', label: `${c.tools_ok} action${c.tools_ok > 1 ? 's' : ''} OK`, tone: 'ok' });
  if (c.tools_failed > 0) {
    pills.push({ key: 'fails', label: `${c.tools_failed} échec${c.tools_failed > 1 ? 's' : ''}`, tone: 'danger' });
  }
  pills.push({
    key: 'decisions',
    label: `${c.decisions} décision${c.decisions > 1 ? 's' : ''}`,
    tone: c.decisions > 0 ? 'accent' : 'muted',
  });
  return pills;
}

/** Preuve cliquable : lien http(s) externe, ou route interne `/app/…`. Sinon texte (chemin). */
export function evidenceLink(evidence: string): { href: string; external: boolean } | null {
  const e = evidence.trim();
  if (/^https?:\/\/[^\s/]/i.test(e)) return { href: e, external: true };
  if (/^\/app\/[^\s]*$/.test(e)) return { href: e, external: false };
  return null;
}

export const OUTCOME_LABEL: Record<string, string> = {
  ok: 'OK',
  failed: 'Échec',
  skipped: 'Ignorée',
  running: 'En cours',
  unknown: 'Issue inconnue',
};

export function outcomeTone(o: RunDecision['outcome']): Tone {
  if (o === 'ok') return 'ok';
  if (o === 'failed' || o === 'unknown') return 'danger';
  if (o === 'running') return 'accent';
  return 'muted';
}

/** Bouton « Réveiller le bot » mis en avant quand le run a besoin d'aide. */
export function needsHelp(live: Pick<RunLive, 'verdict'>): boolean {
  return live.verdict === 'failed' || live.verdict === 'incomplete';
}
