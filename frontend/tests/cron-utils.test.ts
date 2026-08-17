import { describe, expect, it } from 'vitest';
import { formatCron, normalizeCron } from '../src/lib/cron-utils';

describe('formatCron', () => {
    it('traduit une expression quotidienne en français', () => {
        const label = formatCron('0 0 * * *');

        expect(label).not.toBe('0 0 * * *');
        expect(label.toLowerCase()).toMatch(/00:00|minuit|tous les jours/);
    });

    it('normalise l’alias daily', () => {
        expect(normalizeCron('daily')).toBe('0 0 * * *');
        expect(formatCron('daily')).toBe(formatCron('0 0 * * *'));
    });
});
