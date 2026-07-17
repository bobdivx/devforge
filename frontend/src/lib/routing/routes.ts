import {
    Activity,
    Bot,
    Boxes,
    Braces,
    Database,
    Gauge,
    GitBranch,
    Rocket,
    Settings,
    Tag,
    HardDrive,
    MapPin,
    CreditCard,
    Cloud,
    Wrench,
    type LucideIcon,
} from 'lucide-preact';

import { settingsTabPaths } from './settings-tabs';
import { DEVFORGE_BASE_PATH, normalizeRoutePath } from './route-path';

export { DEVFORGE_BASE_PATH, normalizeRoutePath };



export type PageKey =

    | 'dashboard'

    | 'applications'

    | 'application-detail'

    | 'databases'

    | 'services'

    | 'deployments'

    | 'monitoring'

    | 'settings'

    | 'shared-variables'

    | 'profile'

    | 'terminal'

    | 'github'

    | 'sources'

    | 'destinations'

    | 'tags'

    | 'subscription'

    | 'onboarding'

    | 'storages'

    | 'storage'

    | 'server-detail'

    | 'agents'

    | 'agent-detail'

    | 'not-found';



export type AppRoute = {

    path: string;

    label: string;

    description: string;

    icon: LucideIcon;

    page: PageKey;

};



export const appRoutes: AppRoute[] = [

    { path: '/', label: "Vue d'ensemble", description: 'Santé et activité de la plateforme.', icon: Gauge, page: 'dashboard' },

    { path: '/applications', label: 'Applications', description: 'Configuration et déploiements.', icon: Boxes, page: 'applications' },

    { path: '/github', label: 'GitHub', description: 'Compte GitHub, apps et token Packages.', icon: GitBranch, page: 'github' },

    { path: '/databases', label: 'Bases de données', description: 'Instances, sauvegardes et métriques.', icon: Database, page: 'databases' },

    { path: '/services', label: 'Services', description: 'Stacks et services gérés.', icon: Wrench, page: 'services' },

    { path: '/deployments', label: 'Déploiements', description: 'Files et historiques de livraison.', icon: Rocket, page: 'deployments' },

    { path: '/storage', label: 'Stockage', description: 'Espace disque, nettoyage Docker et surveillance.', icon: HardDrive, page: 'storage' },

    { path: '/monitoring', label: 'Supervision', description: 'État et métriques système.', icon: Activity, page: 'monitoring' },

    { path: '/settings', label: 'Paramètres', description: 'Projets, serveurs, équipe et configuration.', icon: Settings, page: 'settings' },

    { path: '/agents', label: 'Agents IA', description: "Équipe d'agents autonomes DevForge.", icon: Bot, page: 'agents' },

];



export const staticRoutePaths = [

    ...appRoutes.map(({ path }) => path),

    ...settingsTabPaths.filter((path) => path !== '/settings'),

    '/shared-variables',

    '/shared-variables/team',

    '/shared-variables/projects',

    '/shared-variables/environments',

    '/shared-variables/servers',

    '/profile',

    '/profile/appearance',

    '/terminal',

    '/github',

    '/sources',

    '/storages',

    '/storage',

    '/destinations',

    '/tags',

    '/subscription',

    '/subscription/new',

    '/onboarding',

    '/notifications/email',

    '/notifications/discord',

    '/notifications/slack',

    '/notifications/telegram',

    '/notifications/pushover',

    '/notifications/webhook',

    '/security/private-key',

    '/security/cloud-tokens',

    '/security/cloud-init-scripts',

    '/security/api-tokens',

    '/team',

    '/team/members',

    '/team/admin',

];



export function routeHref(path: string): string {
    const queryIndex = path.search(/[?#]/);
    const pathname = queryIndex === -1 ? path : path.slice(0, queryIndex);
    const suffix = queryIndex === -1 ? '' : path.slice(queryIndex);

    if (pathname === '/') {
        return `${DEVFORGE_BASE_PATH}/${suffix}`;
    }

    const normalizedPath = `${pathname.replace(/\/+$/, '')}/`;

    return `${DEVFORGE_BASE_PATH}${normalizedPath}${suffix}`;
}



export function applicationPath(uuid: string): string {

    return `/applications/${uuid}`;

}



export function extractApplicationUuid(pathname: string): string | null {

    const normalizedPath = normalizeRoutePath(pathname);

    const match = normalizedPath.match(/^\/applications\/([^/]+)/);

    return match?.[1] ?? null;

}



export function visibleRoutes(agentsEnabled: boolean): AppRoute[] {

    return appRoutes.filter(({ page }) => agentsEnabled || page !== 'agents');

}



function appRouteByPage(page: PageKey): AppRoute {
    const route = appRoutes.find((entry) => entry.page === page);

    if (!route) {
        throw new Error(`Route manquante dans appRoutes: ${page}`);
    }

    return route;
}



const applicationsRoute = appRouteByPage('applications');

const databasesRoute = appRouteByPage('databases');

const servicesRoute = appRouteByPage('services');

const settingsRoute = appRouteByPage('settings');

const sharedVariablesRoute: AppRoute = {

    path: '/shared-variables',

    label: 'Variables partagées',

    description: 'Variables d’équipe, de projet, d’environnement et de serveur.',

    icon: Braces,

    page: 'shared-variables',

};

const agentsRoute = appRouteByPage('agents');

const profileRoute: AppRoute = {
    path: '/profile',
    label: 'Profil',
    description: 'Compte utilisateur et préférences personnelles.',
    icon: Settings,
    page: 'profile',
};

const terminalRoute: AppRoute = {
    path: '/terminal',
    label: 'Terminal',
    description: 'Connexion aux serveurs et conteneurs.',
    icon: Wrench,
    page: 'terminal',
};

const githubRoute = appRouteByPage('github');

const sourcesRoute: AppRoute = {
    path: '/sources',
    label: 'Sources',
    description: 'Dépôts et applications Git connectés.',
    icon: GitBranch,
    page: 'sources',
};

const destinationsRoute: AppRoute = {
    path: '/destinations',
    label: 'Destinations',
    description: 'Réseaux Docker et cibles de déploiement.',
    icon: MapPin,
    page: 'destinations',
};

const tagsRoute: AppRoute = {
    path: '/tags',
    label: 'Tags',
    description: 'Déploiements groupés par tag.',
    icon: Tag,
    page: 'tags',
};

const subscriptionRoute: AppRoute = {
    path: '/subscription',
    label: 'Abonnement',
    description: 'Plan et facturation Coolify Cloud.',
    icon: CreditCard,
    page: 'subscription',
};

const onboardingRoute: AppRoute = {
    path: '/onboarding',
    label: 'Onboarding',
    description: 'Assistant de configuration initiale.',
    icon: Settings,
    page: 'onboarding',
};

const storagesRoute: AppRoute = {
    path: '/storages',
    label: 'Stockage S3',
    description: 'Stockage objet et sauvegardes.',
    icon: Cloud,
    page: 'storages',
};

const serverDetailRoute: AppRoute = {
    path: '/server',
    label: 'Serveur',
    description: 'Configuration et supervision d’un serveur.',
    icon: Wrench,
    page: 'server-detail',
};



const legacySettingsPaths: Array<{ pattern: RegExp; path: string }> = [

    { pattern: /^\/projects(?:\/.*)?$/, path: '/settings/projects' },

    { pattern: /^\/servers(?:\/.*)?$/, path: '/settings/servers' },

    { pattern: /^\/security$/, path: '/settings/security' },

];



const dynamicRoutes: Array<{ pattern: RegExp; route: AppRoute }> = [

    { pattern: /^\/applications\/[^/]+(?:\/.*)?$/, route: { ...applicationsRoute, page: 'application-detail' } },

    { pattern: /^\/project\/[^/]+\/environment\/[^/]+\/application\/[^/]+(?:\/.*)?$/, route: applicationsRoute },

    { pattern: /^\/project\/[^/]+\/environment\/[^/]+\/database\/[^/]+(?:\/.*)?$/, route: databasesRoute },

    { pattern: /^\/project\/[^/]+\/environment\/[^/]+\/service\/[^/]+(?:\/.*)?$/, route: servicesRoute },

    { pattern: /^\/project\/[^/]+(?:\/.*)?$/, route: { ...settingsRoute, path: '/settings/projects' } },

    { pattern: /^\/server\/[^/]+(?:\/.*)?$/, route: serverDetailRoute },

    { pattern: /^\/destination\/[^/]+(?:\/.*)?$/, route: destinationsRoute },

    { pattern: /^\/destinations(?:\/.*)?$/, route: destinationsRoute },

    { pattern: /^\/tags\/[^/]+(?:\/.*)?$/, route: tagsRoute },

    { pattern: /^\/tags(?:\/.*)?$/, route: tagsRoute },

    { pattern: /^\/subscription(?:\/.*)?$/, route: subscriptionRoute },

    { pattern: /^\/onboarding(?:\/.*)?$/, route: onboardingRoute },

    { pattern: /^\/settings(?:\/.*)?$/, route: settingsRoute },

    { pattern: /^\/shared-variables(?:\/.*)?$/, route: sharedVariablesRoute },

    { pattern: /^\/profile(?:\/.*)?$/, route: profileRoute },

    { pattern: /^\/terminal(?:\/.*)?$/, route: terminalRoute },

    { pattern: /^\/github(?:\/.*)?$/, route: githubRoute },

    { pattern: /^\/sources(?:\/.*)?$/, route: sourcesRoute },

    { pattern: /^\/source\/github\/[^/]+(?:\/.*)?$/, route: sourcesRoute },

    { pattern: /^\/storages\/[^/]+(?:\/.*)?$/, route: storagesRoute },

    { pattern: /^\/storages$/, route: storagesRoute },

    { pattern: /^\/notifications\/[^/]+(?:\/.*)?$/, route: settingsRoute },

    { pattern: /^\/team(?:\/.*)?$/, route: settingsRoute },

    { pattern: /^\/security\/[^/]+(?:\/.*)?$/, route: settingsRoute },

    { pattern: /^\/agents\/[^/]+(?:\/.*)?$/, route: { ...agentsRoute, page: 'agent-detail' } },

];



export function findRoute(pathname: string): AppRoute {

    const normalizedPath = normalizeRoutePath(pathname);

    const exactRoute = appRoutes.find(({ path }) => path === normalizedPath);

    if (exactRoute) {

        return exactRoute;

    }



    const legacySettings = legacySettingsPaths.find(({ pattern }) => pattern.test(normalizedPath));

    if (legacySettings) {

        return {

            ...settingsRoute,

            path: legacySettings.path,

        };

    }



    const dynamicRoute = dynamicRoutes.find(({ pattern }) => pattern.test(normalizedPath));

    if (dynamicRoute) {

        if (dynamicRoute.route.page === 'settings') {

            const path = normalizedPath.startsWith('/settings')
                || normalizedPath.startsWith('/notifications/')
                || normalizedPath.startsWith('/security/')
                || normalizedPath.startsWith('/team')

                ? normalizedPath

                : dynamicRoute.route.path;



            return {

                ...settingsRoute,

                path,

            };

        }



        if (dynamicRoute.route.page === 'shared-variables') {

            return {

                ...sharedVariablesRoute,

                path: normalizedPath,

            };

        }



        if (['profile', 'terminal', 'github', 'sources', 'storages', 'storage', 'destinations', 'tags', 'subscription', 'onboarding', 'server-detail'].includes(dynamicRoute.route.page)) {

            return {

                ...dynamicRoute.route,

                path: normalizedPath,

            };

        }



        return {

            ...dynamicRoute.route,

            path: normalizedPath,

            label: `${dynamicRoute.route.label} · Détail`,

        };

    }



    return {

        path: normalizedPath,

        label: 'Page introuvable',

        description: "Cette route DevForge n'est pas connue.",

        icon: Gauge,

        page: 'not-found',

    };

}


