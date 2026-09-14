/** Labels / tons pour le statut projet (réel, pas « ready » fictif). */
export function projectStatusMeta(status: string): {
  label: string;
  tone: 'ok' | 'warn' | 'danger' | 'neutral';
} {
  switch (status) {
    case 'live':
    case 'running':
    case 'success':
    case 'completed':
    case 'finished':
      return { label: status === 'live' || status === 'running' ? 'En ligne' : 'OK', tone: 'ok' };
    case 'unhealthy':
      return { label: 'Site inaccessible', tone: 'danger' };
    case 'deploying':
    case 'building':
    case 'queued':
      return { label: 'Déploiement…', tone: 'warn' };
    case 'failed':
    case 'error':
      return { label: 'Échec', tone: 'danger' };
    case 'stopped':
      return { label: 'Arrêté', tone: 'neutral' };
    case 'draft':
    case 'ready': // legacy faux-positif à la création
      return { label: 'Non déployé', tone: 'neutral' };
    default:
      return { label: status || 'Inconnu', tone: 'neutral' };
  }
}

/** Sync déploiement vs tip GitHub (branche). */
export function projectSyncMeta(sync?: {
  state?: string;
  behind_by?: number;
  error?: string | null;
} | null): { label: string; tone: 'ok' | 'warn' | 'danger' | 'neutral'; title?: string } {
  if (!sync?.state) return { label: '—', tone: 'neutral' };
  switch (sync.state) {
    case 'up_to_date':
      return { label: 'À jour', tone: 'ok' };
    case 'behind': {
      const n = sync.behind_by ?? 0;
      return {
        label: n > 1 ? `${n} commits en retard` : n === 1 ? '1 commit en retard' : 'En retard',
        tone: 'warn',
      };
    }
    case 'ahead':
      return { label: 'En avance', tone: 'neutral' };
    case 'deploying':
      return { label: 'En cours…', tone: 'warn' };
    case 'error':
      return {
        label: 'Erreur',
        tone: 'danger',
        title: sync.error || undefined,
      };
    case 'no_deploy':
      return { label: 'Pas encore déployé', tone: 'neutral' };
    case 'no_git':
      return { label: 'Sans Git', tone: 'neutral' };
    case 'unknown':
      return { label: 'Sync inconnue', tone: 'neutral' };
    default:
      return { label: sync.state, tone: 'neutral' };
  }
}
