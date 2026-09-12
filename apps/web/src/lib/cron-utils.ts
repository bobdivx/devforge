/**
 * Convertit une expression cron en phrase française lisible.
 * Supporte les expressions Unix 5-champs standard.
 */
export function cronToFrench(expr: string): string {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) {
    return 'Planification avancée';
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;

  // Toutes les X minutes
  if (minute.startsWith('*/') && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    const interval = minute.slice(2);
    return `Toutes les ${interval} minutes`;
  }

  // Toutes les heures
  if (minute === '0' && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return 'Toutes les heures';
  }

  // Tous les jours à HH:mm
  if (!minute.includes('*') && !hour.includes('*') && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return `Tous les jours à ${hour.padStart(2, '0')}h${minute.padStart(2, '0')}`;
  }

  // Jours de semaine spécifiques à HH:mm
  if (!minute.includes('*') && !hour.includes('*') && dayOfMonth === '*' && month === '*' && dayOfWeek !== '*') {
    const days = parseDaysOfWeek(dayOfWeek);
    if (days) {
      return `${days} à ${hour.padStart(2, '0')}h${minute.padStart(2, '0')}`;
    }
  }

  // Jours du mois spécifiques à HH:mm
  if (!minute.includes('*') && !hour.includes('*') && dayOfMonth !== '*' && month === '*' && dayOfWeek === '*') {
    if (dayOfMonth === '1') {
      return `Le 1er de chaque mois à ${hour.padStart(2, '0')}h${minute.padStart(2, '0')}`;
    }
    return `Le ${dayOfMonth} de chaque mois à ${hour.padStart(2, '0')}h${minute.padStart(2, '0')}`;
  }

  // Jours de semaine (lun-ven) à HH:mm
  if (!minute.includes('*') && !hour.includes('*') && dayOfMonth === '*' && month === '*' && dayOfWeek === '1-5') {
    return `En semaine (lun-ven) à ${hour.padStart(2, '0')}h${minute.padStart(2, '0')}`;
  }

  // Fallback pour expressions complexes
  return 'Planification avancée';
}

function parseDaysOfWeek(dayOfWeek: string): string | null {
  const dayNames = ['Tous les dimanches', 'Tous les lundis', 'Tous les mardis', 'Tous les mercredis', 'Tous les jeudis', 'Tous les vendredis', 'Tous les samedis'];
  
  if (dayOfWeek === '1-5') return 'En semaine (lun-ven)';
  if (dayOfWeek === '0,6' || dayOfWeek === '6,0') return 'Les week-ends';
  
  const single = parseInt(dayOfWeek, 10);
  if (!isNaN(single) && single >= 0 && single <= 6) {
    return dayNames[single];
  }

  return null;
}

/**
 * Presets de planification courants
 */
export const CRON_PRESETS = [
  { label: 'Toutes les 5 minutes', value: '*/5 * * * *' },
  { label: 'Toutes les 15 minutes', value: '*/15 * * * *' },
  { label: 'Toutes les 30 minutes', value: '*/30 * * * *' },
  { label: 'Toutes les heures', value: '0 * * * *' },
  { label: 'Tous les jours à 00h00', value: '0 0 * * *' },
  { label: 'Tous les jours à 02h00', value: '0 2 * * *' },
  { label: 'Tous les jours à 10h00', value: '0 10 * * *' },
  { label: 'En semaine à 09h00', value: '0 9 * * 1-5' },
  { label: 'Tous les lundis à 09h00', value: '0 9 * * 1' },
  { label: 'Le 1er du mois à 00h00', value: '0 0 1 * *' },
  { label: 'Personnalisé', value: '' },
] as const;
