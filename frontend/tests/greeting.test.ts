import { describe, expect, it } from 'vitest';
import { dayGreeting, formatDashboardDate } from '../src/lib/greeting';

describe('salutations du dashboard', () => {
    it('adapte le message selon l’heure', () => {
        expect(dayGreeting('Ada Lovelace', new Date('2026-08-20T08:00:00'))).toBe('Bonjour, Ada');
        expect(dayGreeting('Ada Lovelace', new Date('2026-08-20T15:00:00'))).toBe('Bon après-midi, Ada');
        expect(dayGreeting('Ada Lovelace', new Date('2026-08-20T21:00:00'))).toBe('Bonsoir, Ada');
    });

    it('formate la date en français', () => {
        expect(formatDashboardDate(new Date('2026-08-20T10:00:00'))).toMatch(/20/);
        expect(formatDashboardDate(new Date('2026-08-20T10:00:00'))).toMatch(/août/i);
    });
});
