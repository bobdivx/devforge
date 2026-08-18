import { describe, expect, it } from 'vitest';
import { findRoute, normalizeRoutePath, resolveResourceCanonicalLocation, routeHref, visibleRoutes, appRoutes } from '../src/lib/routes';
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
        expect(routeHref('/databases?uuid=btnfr114ubmua4nvk73y4h6u&tab=data')).toBe(
            '/devforge/databases/?uuid=btnfr114ubmua4nvk73y4h6u&tab=data',
        );
    });

    it('reconnaît les routes dynamiques de ressources', () => {
        expect(findRoute('/devforge/server/server-uuid/metrics').page).toBe('server-detail');
        expect(findRoute('/devforge/server/server-uuid/metrics').path).toBe('/server/server-uuid/metrics');
        expect(findRoute('/devforge/applications/app-uuid').page).toBe('application-detail');
        expect(findRoute('/devforge/applications/app-uuid').path).toBe('/applications/app-uuid');
        expect(routeHref('/applications/app-uuid')).toBe('/devforge/applications/app-uuid/');
        expect(
            findRoute('/devforge/project/project-uuid/environment/environment-uuid/application/app-uuid/logs').page,
        ).toBe('application-detail');
        expect(
            findRoute('/devforge/project/project-uuid/environment/environment-uuid/application/app-uuid/logs').path,
        ).toBe('/applications/app-uuid');
        expect(
            findRoute('/devforge/project/project-uuid/environment/environment-uuid/database/db-uuid/backups').page,
        ).toBe('databases');
        expect(
            findRoute('/devforge/project/project-uuid/environment/environment-uuid/database/db-uuid/backups').path,
        ).toBe('/databases');
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

    it('résout les routes des variables partagées', () => {
        expect(findRoute('/devforge/shared-variables').page).toBe('shared-variables');
        expect(findRoute('/devforge/shared-variables/team').path).toBe('/shared-variables/team');
        expect(findRoute('/devforge/shared-variables/projects').page).toBe('shared-variables');
        expect(
            findRoute('/devforge/shared-variables/project/project-uuid').path,
        ).toBe('/shared-variables/project/project-uuid');
    });

    it('résout les onglets paramètres', () => {
        expect(parseSettingsTab('/settings')).toBe('account');
        expect(parseSettingsTab('/settings/projects')).toBe('projects');
        expect(parseSettingsTab('/settings/storages')).toBe('storages');
        expect(parseSettingsTab('/settings/servers')).toBe('servers');
        expect(parseSettingsTab('/settings/advanced')).toBe('advanced');
        expect(parseSettingsTab('/settings/oauth')).toBe('oauth');
        expect(parseSettingsTab('/settings/sso')).toBe('sso');
        expect(findRoute('/settings/sso').page).toBe('sso');
        expect(findRoute('/devforge/settings/sso').path).toBe('/settings/sso');
        expect(parseSettingsTab('/notifications/email')).toBe('notifications');
        expect(parseSettingsTab('/security/api-tokens')).toBe('security');
        expect(parseSettingsTab('/team/members')).toBe('team');
        expect(parseSettingsTab('/profile')).toBe('account');
        expect(settingsTabPath('security')).toBe('/settings/security');
        expect(settingsTabPath('backup')).toBe('/settings/backup');
    });

    it('résout les pages standalone et routes legacy', () => {
        expect(findRoute('/devforge/profile').page).toBe('profile');
        expect(findRoute('/devforge/profile/appearance').path).toBe('/profile/appearance');
        expect(findRoute('/devforge/terminal').page).toBe('terminal');
        expect(findRoute('/devforge/sources').page).toBe('sources');
        expect(findRoute('/devforge/source/github/app-uuid').page).toBe('connexions');
        expect(findRoute('/devforge/source/github/app-uuid').path).toBe('/source/github/app-uuid');
        expect(findRoute('/devforge/notifications/slack').page).toBe('settings');
        expect(findRoute('/devforge/notifications/slack').path).toBe('/notifications/slack');
        expect(findRoute('/devforge/security/cloud-tokens').page).toBe('settings');
        expect(findRoute('/devforge/security/cloud-tokens').path).toBe('/security/cloud-tokens');
        expect(findRoute('/devforge/team').page).toBe('settings');
        expect(findRoute('/devforge/team/members').path).toBe('/team/members');
        expect(findRoute('/devforge/destinations').page).toBe('destinations');
        expect(findRoute('/devforge/destination/dest-uuid').path).toBe('/destination/dest-uuid');
        expect(findRoute('/devforge/tags/production').page).toBe('tags');
        expect(findRoute('/devforge/tags/production').path).toBe('/tags/production');
        expect(findRoute('/devforge/subscription').page).toBe('subscription');
        expect(findRoute('/devforge/onboarding').page).toBe('onboarding');
        expect(findRoute('/devforge/storages').page).toBe('storages');
        expect(findRoute('/devforge/storage').page).toBe('storage');
        expect(findRoute('/devforge/storages/storage-uuid').path).toBe('/storages/storage-uuid');
        expect(findRoute('/devforge/storages/storage-uuid/resources').page).toBe('storages');
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

    it('expose Stockage dans le menu principal', () => {
        const routes = visibleRoutes(false);
        const storage = routes.find(({ page }) => page === 'storage');

        expect(storage?.path).toBe('/storage');
        expect(storage?.label).toBe('Stockage');
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

    it('redirige les anciens paramètres AI vers /agents/settings', () => {
        expect(resolveResourceCanonicalLocation('/settings/ai')).toBe('/agents/settings');
        expect(resolveResourceCanonicalLocation('/devforge/settings/ai')).toBe('/agents/settings');
        expect(findRoute('/settings/ai').page).toBe('agents-settings');
        expect(findRoute('/devforge/settings/ai').path).toBe('/agents/settings');
        expect(findRoute('/agents/settings').page).toBe('agents-settings');
    });

    it('expose la page Automations et l’alias pluriel', () => {
        expect(findRoute('/automation').page).toBe('automation');
        expect(findRoute('/devforge/automation').path).toBe('/automation');
        expect(findRoute('/automations').page).toBe('automation');
        expect(findRoute('/automations').path).toBe('/automation');
        expect(resolveResourceCanonicalLocation('/automations')).toBe('/automation');
        expect(visibleRoutes(false).some(({ page }) => page === 'automation')).toBe(false);
        expect(visibleRoutes(true).some(({ page }) => page === 'automation')).toBe(true);
    });
});
