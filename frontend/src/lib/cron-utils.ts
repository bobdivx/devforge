import cronstrue from 'cronstrue';
import 'cronstrue/locales/fr';

const ALIASES: Record<string, string> = {
    'every_minute': '* * * * *',
    'hourly': '0 * * * *',
    'daily': '0 0 * * *',
    'weekly': '0 0 * * 0',
    'monthly': '0 0 1 * *',
};

export const COMMON_CRONS = [
    { label: 'Toutes les minutes', value: '* * * * *' },
    { label: 'Toutes les heures', value: '0 * * * *' },
    { label: 'Tous les jours à minuit', value: '0 0 * * *' },
    { label: 'Toutes les semaines (dimanche minuit)', value: '0 0 * * 0' },
    { label: 'Tous les mois (le 1er à minuit)', value: '0 0 1 * *' },
];

/**
 * Format a cron string (or a coolify alias) into a human readable string in French.
 */
export function formatCron(cronOrAlias: string): string {
    if (!cronOrAlias) return '-';
    
    let cron = cronOrAlias.trim();
    if (ALIASES[cron]) {
        cron = ALIASES[cron];
    }
    
    try {
        return cronstrue.toString(cron, { locale: 'fr', use24HourTimeFormat: true });
    } catch (e) {
        // If it's invalid cron, just return the raw string or alias
        return cronOrAlias;
    }
}

/**
 * Convert an alias to its raw cron format if applicable.
 */
export function normalizeCron(cronOrAlias: string): string {
    const trimmed = (cronOrAlias || '').trim();
    return ALIASES[trimmed] || trimmed;
}
