import { afterEach, describe, expect, it } from 'vitest';
import {
    BOT_STUDIO_TOOLS_KEY,
    filterBotTools,
    hasCompletedToolsOnboarding,
    loadSelectedTools,
    saveSelectedTools,
    scheduleForMission,
    BOT_TOOLS,
} from '../src/lib/bot-studio';

describe('bot-studio', () => {
    afterEach(() => {
        localStorage.removeItem(BOT_STUDIO_TOOLS_KEY);
    });

    it('filtre les outils par nom ou indice', () => {
        const matches = filterBotTools(BOT_TOOLS, 'git');
        expect(matches.map((tool) => tool.id)).toEqual(expect.arrayContaining(['github', 'github-actions']));
        expect(filterBotTools(BOT_TOOLS, 'inexistant')).toEqual([]);
    });

    it('ignore les outils coming soon à la sauvegarde', () => {
        saveSelectedTools(['github', 'sentry', 'nope']);
        expect(loadSelectedTools()).toEqual(['github']);
        expect(hasCompletedToolsOnboarding()).toBe(true);
    });

    it('planifie le point hebdomadaire le matin en semaine', () => {
        expect(scheduleForMission({
            type: 'tech-watch',
            schedulePreset: 'workday-morning',
        })).toEqual({
            schedule_minutes: 0,
            schedule_cron: '0 9 * * 1-5',
        });
    });

    it('force un planning vide pour les agents événementiels', () => {
        expect(scheduleForMission({ type: 'github-actions' })).toEqual({
            schedule_minutes: 0,
            schedule_cron: null,
        });
    });
});
