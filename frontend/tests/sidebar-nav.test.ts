import { describe, expect, it } from 'vitest';
import { findRoute } from '../src/lib/routes';
import {
    flattenSidebarNav,
    plusSidebarSection,
    primarySidebarNav,
    resolveActiveNavId,
    visibleSidebarNav,
} from '../src/lib/routing/sidebar-nav';

describe('sidebar-nav PandaOS', () => {
    it('garde une barre mince : Accueil, Apps, Assistant, Connexions, Réglages + Plus', () => {
        const entries = visibleSidebarNav(true, false);
        const labels = primarySidebarNav(entries).map((item) => item.label);
        const plus = plusSidebarSection(entries);

        expect(labels).toEqual(['Accueil', 'Apps', 'Assistant', 'Connexions', 'Réglages']);
        expect(plus?.items.map((item) => item.id)).toContain('servers');
        expect(plus?.items.map((item) => item.id)).toContain('store');
        expect(plus?.items.some((item) => item.id === 'agents-manage')).toBe(true);
    });

    it('montre l’assistant onboarding si les agents sont désactivés', () => {
        const entries = visibleSidebarNav(false, false);
        const primary = primarySidebarNav(entries);

        expect(primary.find((item) => item.label === 'Assistant')?.path).toBe('/onboarding');
        expect(plusSidebarSection(entries)?.items.some((item) => item.requiresAgents)).toBe(false);
    });

    it('active Serveurs plutôt que Réglages sur /settings/servers', () => {
        const entries = visibleSidebarNav(false);

        expect(resolveActiveNavId(entries, findRoute('/settings/servers'))).toBe('servers');
        expect(resolveActiveNavId(entries, findRoute('/settings'))).toBe('settings');
        expect(resolveActiveNavId(entries, findRoute('/settings/team'))).toBe('settings');
        expect(resolveActiveNavId(entries, findRoute('/server/abc'))).toBe('servers');
    });

    it('active Connexions sur les routes GitHub legacy', () => {
        const entries = visibleSidebarNav(false);

        expect(resolveActiveNavId(entries, findRoute('/github'))).toBe('connexions');
        expect(resolveActiveNavId(entries, findRoute('/sources'))).toBe('connexions');
    });

    it('aplatit les liens pour le mode réduit', () => {
        const flat = flattenSidebarNav(visibleSidebarNav(false));
        expect(flat[0]?.path).toBe('/');
        expect(flat.some(({ path }) => path === '/applications')).toBe(true);
        expect(flat.some(({ path }) => path === '/storage')).toBe(true);
        expect(flat.some(({ id }) => id === 'plus')).toBe(false);
        expect(flat.some(({ id }) => id === 'servers')).toBe(true);
    });
});
