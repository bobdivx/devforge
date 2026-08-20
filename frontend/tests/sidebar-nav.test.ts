import { describe, expect, it } from 'vitest';
import { findRoute } from '../src/lib/routes';
import {
    flattenSidebarNav,
    isNavSectionActive,
    resolveActiveNavId,
    visibleSidebarNav,
    type SidebarNavSection,
} from '../src/lib/routing/sidebar-nav';

describe('navigation latérale par sections', () => {
    it('regroupe les workloads sous Ressources, sans accordéon ni libellé Gérer', () => {
        const entries = visibleSidebarNav(false);
        const resources = entries.find(
            (entry): entry is SidebarNavSection => entry.type === 'section' && entry.id === 'resources',
        );

        expect(resources).toBeTruthy();
        expect(resources?.items.map(({ label, path }) => ({ label, path }))).toEqual([
            { label: 'Applications', path: '/applications' },
            { label: 'Bases de données', path: '/databases' },
            { label: 'Services', path: '/services' },
            { label: 'Store', path: '/store' },
        ]);
    });

    it('place serveurs, supervision et stockage sous Opérations', () => {
        const operations = visibleSidebarNav(false).find(
            (entry): entry is SidebarNavSection => entry.type === 'section' && entry.id === 'operations',
        );

        expect(operations?.items.map(({ label, path }) => ({ label, path }))).toEqual([
            { label: 'Déploiements', path: '/deployments' },
            { label: 'Supervision', path: '/monitoring' },
            { label: 'Stockage', path: '/storage' },
            { label: 'Serveurs', path: '/settings/servers' },
            { label: 'Runners GitHub', path: '/github-runners' },
            { label: 'Tâches planifiées', path: '/scheduled-tasks' },
        ]);
        expect(operations?.items.some(({ path }) => path === '/settings/sso')).toBe(false);
    });

    it('laisse le SSO dans les paramètres, pas dans la barre latérale', () => {
        const entries = visibleSidebarNav(false, true);
        const links = flattenSidebarNav(entries);

        expect(links.some(({ path }) => path === '/settings/sso')).toBe(false);
        expect(resolveActiveNavId(entries, findRoute('/settings/sso'))).toBe('settings');
    });

    it('masque les agents quand la fonctionnalité est désactivée', () => {
        expect(visibleSidebarNav(false).some((entry) => entry.id === 'agents')).toBe(false);
        expect(visibleSidebarNav(true).some((entry) => entry.id === 'agents')).toBe(true);
    });

    it('expose Chat, Équipe, Automations et Paramètres AI sous Agents IA', () => {
        const agents = visibleSidebarNav(true).find(
            (entry): entry is SidebarNavSection => entry.type === 'section' && entry.id === 'agents',
        );

        expect(agents?.items.map(({ label, path }) => ({ label, path }))).toEqual([
            { label: 'Chat', path: '/agents/chat' },
            { label: 'Équipe', path: '/agents' },
            { label: 'Automations', path: '/automation' },
            { label: 'Paramètres AI', path: '/agents/settings' },
        ]);
    });

    it('marque la section Ressources active sur une page fille', () => {
        const resources = visibleSidebarNav(false).find(
            (entry): entry is SidebarNavSection => entry.type === 'section' && entry.id === 'resources',
        );

        expect(resources && isNavSectionActive(resources, 'databases')).toBe(true);
        expect(resources && isNavSectionActive(resources, 'dashboard')).toBe(false);
    });

    it('expose les sections sans les replier', () => {
        const entries = visibleSidebarNav(true);
        const sections = entries.filter((entry): entry is SidebarNavSection => entry.type === 'section');

        expect(sections.map(({ id }) => id)).toEqual(['resources', 'operations', 'agents']);
    });

    it('aplatit les liens pour le mode réduit', () => {
        const flat = flattenSidebarNav(visibleSidebarNav(false));
        expect(flat[0]?.path).toBe('/');
        expect(flat.some(({ path }) => path === '/applications')).toBe(true);
        expect(flat.some(({ path }) => path === '/storage')).toBe(true);
        expect(flat.some(({ id }) => id === 'resources')).toBe(false);
        expect(flat.some(({ id }) => id === 'servers')).toBe(true);
    });

    it('active Serveurs plutôt que Paramètres sur /settings/servers', () => {
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
});
