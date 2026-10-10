/** Statut d'un déploiement en cours / terminé — libellés FR partagés (en-tête projet, bandeau d'activité, workspace). */

const IN_PROGRESS = ['queued', 'running', 'building', 'pending', 'deploying'];

export function isDeployInProgress(status: string): boolean {
  return IN_PROGRESS.includes(status);
}

/** Vrai SHA Git (pas le placeholder « pending » d'un déploiement qui démarre). */
export function isGitSha(sha?: string | null): boolean {
  return !!sha && /^[0-9a-f]{7,40}$/i.test(sha);
}

/** SHA court, ou null si placeholder. */
export function shortSha(sha?: string | null): string | null {
  return isGitSha(sha) ? sha!.slice(0, 7) : null;
}

/** Libellé FR d'un statut de déploiement (jamais le code brut anglais). */
export function deployStatusLabel(status: string): string {
  switch (status) {
    case 'queued':
    case 'pending':
      return 'Déploiement en attente';
    case 'running':
    case 'building':
    case 'deploying':
      return 'Déploiement en cours';
    case 'success':
    case 'finished':
    case 'succeeded':
      return 'Déploiement réussi';
    case 'failed':
    case 'error':
      return 'Échec du déploiement';
    case 'cancelled':
    case 'canceled':
      return 'Déploiement annulé';
    default:
      return 'Déploiement';
  }
}

/** Détail court d'un déploiement en cours : version si connue, sinon étape. */
export function deployProgressDetail(sha?: string | null): string {
  const s = shortSha(sha);
  return s ? `Version ${s}` : 'Clone et build…';
}

/** Libellé court FR pour une pastille de statut (liste des déploiements). */
export function deployStatusShort(status: string): string {
  switch (status) {
    case 'queued':
    case 'pending':
      return 'En attente';
    case 'running':
    case 'building':
    case 'deploying':
      return 'En cours';
    case 'success':
    case 'finished':
    case 'succeeded':
      return 'Réussi';
    case 'failed':
    case 'error':
      return 'Échec';
    case 'cancelled':
    case 'canceled':
      return 'Annulé';
    default:
      return status;
  }
}
