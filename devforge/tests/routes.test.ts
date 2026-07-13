import { describe, expect, it } from 'vitest';
import { findRoute, normalizeRoutePath, routeHref, visibleRoutes, appRoutes } from '../src/lib/routes';
import { parseSettingsTab, settingsTabPath } from '../src/lib/settings-tabs';

describe('routage DevForge', () => {
    it('normalise les URL servies sous la base statique', () => {
        expect(normalizeRoutePath('/devforge/servers/')).toBe('/servers');
        expect(normalizeRoutePath('/devforge/')).toBe('/');
        expect(normalizeRoutePath('/devforge/settings/projects/')).toBe('/settings/projects');
    });

    it('construit des liens compatibles avec la base Astro', () => {
        expect(routeHref('/')).toBe('/devforge/');
        expect(routeHref('/applications')).toBe('/devforge/applications/');
        expect(routeHref('/settings/servers')).toBe('/devforge/settings/servers/');
    });

    it('reconnaît les routes dynamiques de ressources', () => {
        expect(findRoute('/devforge/server/server-uuid/metrics').page).toBe('settings');
        expect(findRoute('/devforge/server/server-uuid/metrics').path).toBe('/settings/servers');
        expect(findRoute('/devforge/applications/app-uuid').page).toBe('application-detail');
        expect(findRoute('/devforge/applications/app-uuid').path).toBe('/applications/app-uuid');
        expect(routeHref('/applications/app-uuid')).toBe('/devforge/applications/app-uuid/');
        expect(
            findRoute('/devforge/project/project-uuid/environment/environment-uuid/application/app-uuid/logs').page,
        ).toBe('applications');
        expect(
            findRoute('/devforge/project/project-uuid/environment/environment-uuid/database/db-uuid/backups').page,
        ).toBe('databases');
        expect(findRoute('/devforge/project/project-uuid').page).toBe('settings');
        expect(findRoute('/devforge/project/project-uuid').path).toBe('/settings/projects');
    });

    it('redirige les anciennes routes vers les onglets paramètres', () => {
        expect(findRoute('/devforge/projects').page).toBe('settings');
        expect(findRoute('/devforge/projects').path).toBe('/settings/projects');
        expect(findRoute('/devforge/servers').page).toBe('settings');
        expect(findRoute('/devforge/servers').path).toBe('/settings/servers');
        expect(findRoute('/devforge/security').page).toBe('settings');
        expect(findRoute('/devforge/security').path).toBe('/settings/security');
    });

    it('résout les onglets paramètres', () => {
        expect(parseSettingsTab('/settings')).toBe('account');
        expect(parseSettingsTab('/settings/projects')).toBe('projects');
        expect(parseSettingsTab('/settings/storages')).toBe('storages');
        expect(parseSettingsTab('/settings/servers')).toBe('servers');
        expect(settingsTabPath('security')).toBe('/settings/security');
    });

    it('signale explicitement une route inconnue', () => {
        expect(findRoute('/devforge/inconnue').page).toBe('not-found');
        expect(findRoute('/devforge/inconnue').path).toBe('/inconnue');
    });

    it('masque la navigation agents quand la fonctionnalité est désactivée', () => {
        expect(visibleRoutes(false).some(({ page }) => page === 'agents')).toBe(false);
        expect(visibleRoutes(true).some(({ page }) => page === 'agents')).toBe(true);
        expect(visibleRoutes(false).some(({ path }) => path === '/projects')).toBe(false);
        expect(visibleRoutes(false).some(({ path }) => path === '/servers')).toBe(false);
    });

    it('priorise les applications dans le menu principal', () => {
        const routes = visibleRoutes(false);
        expect(routes[1].page).toBe('applications');
    });

    it('expose des libellés français lisibles sans séquences unicode échappées', () => {
        for (const route of appRoutes) {
            expect(route.label).not.toMatch(/\\u[0-9a-f]{4}/i);
            expect(route.description).not.toMatch(/\\u[0-9a-f]{4}/i);
        }

        expect(findRoute('/agents').description).toBe("Équipe d'agents autonomes DevForge.");
    });
});
