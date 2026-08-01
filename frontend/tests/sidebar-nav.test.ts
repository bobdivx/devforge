import { describe, expect, it } from 'vitest';
import {
    flattenSidebarNav,
    isNavGroupActive,
    visibleSidebarNav,
    type SidebarNavGroup,
} from '../src/lib/routing/sidebar-nav';

describe('navigation latérale groupée', () => {
    it('regroupe applications, bases, services et déploiements', () => {
        const entries = visibleSidebarNav(false);
        const applications = entries.find(
            (entry): entry is SidebarNavGroup => entry.type === 'group' && entry.id === 'applications',
        );

        expect(applications).toBeTruthy();
        expect(applications?.items.map(({ label }) => label)).toEqual([
            'Gérer',
            'Bases de données',
            'Services',
            'Déploiements',
        ]);
        expect(applications?.items.map(({ path }) => path)).toEqual([
            '/applications',
            '/databases',
            '/services',
            '/deployments',
        ]);
    });

    it('regroupe le stockage sous Infrastructure', () => {
        const entries = visibleSidebarNav(false);
        const infrastructure = entries.find(
            (entry): entry is SidebarNavGroup => entry.type === 'group' && entry.id === 'infrastructure',
        );

        expect(infrastructure?.items.some(({ path }) => path === '/storage')).toBe(true);
        expect(infrastructure?.items.some(({ path }) => path === '/monitoring')).toBe(true);
    });

    it('masque les agents quand la fonctionnalité est désactivée', () => {
        expect(visibleSidebarNav(false).some((entry) => entry.id === 'agents')).toBe(false);
        expect(visibleSidebarNav(true).some((entry) => entry.id === 'agents')).toBe(true);
    });

    it('expose Gérer et Paramètres AI sous Agents IA', () => {
        const agents = visibleSidebarNav(true).find(
            (entry): entry is SidebarNavGroup => entry.type === 'group' && entry.id === 'agents',
        );

        expect(agents?.items.map(({ label, path }) => ({ label, path }))).toEqual([
            { label: 'Gérer', path: '/agents' },
            { label: 'Paramètres AI', path: '/agents/settings' },
        ]);
    });

    it('ouvre le groupe Applications sur une page fille', () => {
        const applications = visibleSidebarNav(false).find(
            (entry): entry is SidebarNavGroup => entry.type === 'group' && entry.id === 'applications',
        );

        expect(applications && isNavGroupActive(applications, 'databases')).toBe(true);
        expect(applications && isNavGroupActive(applications, 'dashboard')).toBe(false);
    });

    it('aplatit les liens pour le mode réduit', () => {
        const flat = flattenSidebarNav(visibleSidebarNav(false));
        expect(flat[0]?.path).toBe('/');
        expect(flat.some(({ path }) => path === '/applications')).toBe(true);
        expect(flat.some(({ path }) => path === '/storage')).toBe(true);
        expect(flat.some(({ id }) => id === 'applications')).toBe(false);
    });
});
