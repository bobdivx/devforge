import {
    Activity,
    Bot,
    Boxes,
    Braces,
    Database,
    Gauge,
    Plug,
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

import {
    applicationPath,
    applicationTabFromLegacySegment,
    parseApplicationTab,
    type ApplicationTabId,
} from '../application-tabs';
import { settingsTabPaths } from './settings-tabs';
import { DEVFORGE_BASE_PATH, normalizeRoutePath, sanitizeResourceUuid } from './route-path';

export { DEVFORGE_BASE_PATH, normalizeRoutePath };
export { applicationPath, parseApplicationTab };



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

    | 'connexions'

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

    { path: '/connexions', label: 'Connexions', description: 'GitHub, tokens Packages, clés API et secrets de build.', icon: Plug, page: 'connexions' },

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

    '/connexions',

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



export function extractApplicationUuid(pathname: string): string | null {
    const normalizedPath = normalizeRoutePath(pathname);
    const native = normalizedPath.match(/^\/applications\/([^/]+)/);

    if (native?.[1]) {
        return sanitizeResourceUuid(native[1]);
    }

    const legacy = normalizedPath.match(
        /^\/project\/[^/]+\/environment\/[^/]+\/application\/([^/]+)(?:\/.*)?$/,
    );

    return sanitizeResourceUuid(legacy?.[1] ?? null);
}

export function extractDatabaseUuid(pathname: string): string | null {
    const normalizedPath = normalizeRoutePath(pathname);
    const legacy = normalizedPath.match(
        /^\/project\/[^/]+\/environment\/[^/]+\/database\/([^/]+)(?:\/.*)?$/,
    );

    return sanitizeResourceUuid(legacy?.[1] ?? null);
}

export type DatabaseDetailTabId = 'overview' | 'data' | 'backups' | 'logs' | 'variables' | 'webhooks' | 'storage' | 'healthcheck';

const databaseTabIds = new Set<DatabaseDetailTabId>([
    'overview',
    'data',
    'backups',
    'logs',
    'variables',
    'webhooks',
    'storage',
    'healthcheck',
]);

export function parseDatabaseTab(value: string | null | undefined): DatabaseDetailTabId {
    if (value && databaseTabIds.has(value as DatabaseDetailTabId)) {
        return value as DatabaseDetailTabId;
    }

    return 'overview';
}

function databaseTabFromLegacySegment(segment: string | undefined): DatabaseDetailTabId {
    if (segment === 'backups') {
        return 'backups';
    }

    if (segment === 'logs') {
        return 'logs';
    }

    if (segment === 'environment-variables' || segment === 'variables') {
        return 'variables';
    }

    if (segment === 'webhooks') {
        return 'webhooks';
    }

    if (segment === 'persistent-storage' || segment === 'storage' || segment === 'storages') {
        return 'storage';
    }

    if (segment === 'healthcheck' || segment === 'health') {
        return 'healthcheck';
    }

    if (segment === 'import-backup') {
        return 'data';
    }

    return 'overview';
}

export function databasePath(uuid: string, tab: DatabaseDetailTabId = 'overview'): string {
    const params = new URLSearchParams({ uuid });

    if (tab !== 'overview') {
        params.set('tab', tab);
    }

    return `/databases?${params.toString()}`;
}

export type ServiceDetailTabId = 'overview' | 'tasks' | 'variables' | 'webhooks' | 'storage';

const serviceTabIds = new Set<ServiceDetailTabId>(['overview', 'tasks', 'variables', 'webhooks', 'storage']);

export function parseServiceTab(value: string | null | undefined): ServiceDetailTabId {
    if (value && serviceTabIds.has(value as ServiceDetailTabId)) {
        return value as ServiceDetailTabId;
    }

    return 'overview';
}

function serviceTabFromLegacySegment(segment: string | undefined): ServiceDetailTabId {
    if (segment === 'scheduled-tasks' || segment === 'tasks') {
        return 'tasks';
    }

    if (segment === 'environment-variables' || segment === 'variables') {
        return 'variables';
    }

    if (segment === 'webhooks') {
        return 'webhooks';
    }

    if (segment === 'storages' || segment === 'storage' || segment === 'persistent-storage') {
        return 'storage';
    }

    return 'overview';
}

export function servicePath(uuid: string, tab: ServiceDetailTabId = 'overview'): string {
    const params = new URLSearchParams({ uuid });

    if (tab !== 'overview') {
        params.set('tab', tab);
    }

    return `/services?${params.toString()}`;
}

/**
 * Réécrit les URLs Coolify `/project/.../application|database|service/...` vers les chemins DevForge canoniques.
 * Retourne null si aucune réécriture n’est nécessaire.
 */
export function resolveResourceCanonicalLocation(pathname: string): string | null {
    const normalizedPath = normalizeRoutePath(pathname);

    const applicationMatch = normalizedPath.match(
        /^\/project\/[^/]+\/environment\/[^/]+\/application\/([^/]+)(?:\/([^/]+))?/,
    );

    if (applicationMatch) {
        const uuid = sanitizeResourceUuid(applicationMatch[1]);

        if (!uuid) {
            return null;
        }

        const tab = applicationTabFromLegacySegment(applicationMatch[2]);

        return applicationPath(uuid, tab);
    }

    const databaseMatch = normalizedPath.match(
        /^\/project\/[^/]+\/environment\/[^/]+\/database\/([^/]+)(?:\/([^/]+))?/,
    );

    if (databaseMatch) {
        const uuid = sanitizeResourceUuid(databaseMatch[1]);

        if (!uuid) {
            return null;
        }

        return databasePath(uuid, databaseTabFromLegacySegment(databaseMatch[2]));
    }

    const serviceMatch = normalizedPath.match(
        /^\/project\/[^/]+\/environment\/[^/]+\/service\/([^/]+)(?:\/([^/]+))?/,
    );

    if (serviceMatch) {
        const uuid = sanitizeResourceUuid(serviceMatch[1]);

        if (!uuid) {
            return null;
        }

        return servicePath(uuid, serviceTabFromLegacySegment(serviceMatch[2]));
    }

    return null;
}

export function readApplicationTabFromLocation(search = typeof window === 'undefined' ? '' : window.location.search): ApplicationTabId {
    const params = new URLSearchParams(search.startsWith('?') || search === '' ? search : `?${search}`);

    return parseApplicationTab(params.get('tab'));
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

const connexionsRoute = appRouteByPage('connexions');

const sourcesRoute: AppRoute = {
    ...connexionsRoute,
    path: '/sources',
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

    { pattern: /^\/project\/[^/]+\/environment\/[^/]+\/application\/[^/]+(?:\/.*)?$/, route: { ...applicationsRoute, page: 'application-detail' } },

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

    { pattern: /^\/connexions(?:\/.*)?$/, route: connexionsRoute },

    { pattern: /^\/github(?:\/.*)?$/, route: connexionsRoute },

    { pattern: /^\/sources(?:\/.*)?$/, route: sourcesRoute },

    { pattern: /^\/source\/github\/[^/]+(?:\/.*)?$/, route: connexionsRoute },

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



        if (dynamicRoute.route.page === 'application-detail') {
            const uuid = extractApplicationUuid(normalizedPath);

            return {
                ...dynamicRoute.route,
                path: uuid ? `/applications/${uuid}` : normalizedPath,
                label: `${applicationsRoute.label} · Détail`,
            };
        }

        if (dynamicRoute.route.page === 'databases' && normalizedPath.startsWith('/project/')) {
            return {
                ...databasesRoute,
                path: '/databases',
                label: `${databasesRoute.label} · Détail`,
            };
        }

        if (dynamicRoute.route.page === 'services' && normalizedPath.startsWith('/project/')) {
            return {
                ...servicesRoute,
                path: '/services',
                label: `${servicesRoute.label} · Détail`,
            };
        }



        if (['profile', 'terminal', 'connexions', 'github', 'sources', 'storages', 'storage', 'destinations', 'tags', 'subscription', 'onboarding', 'server-detail'].includes(dynamicRoute.route.page)) {

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


