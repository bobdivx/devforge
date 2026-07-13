import {

    Activity,

    Bot,

    Boxes,

    Database,

    Gauge,

    Rocket,

    Settings,

    Wrench,

    type LucideIcon,

} from 'lucide-preact';

import { settingsTabPaths } from './settings-tabs';



export const DEVFORGE_BASE_PATH = '/devforge';



export type PageKey =

    | 'dashboard'

    | 'applications'

    | 'application-detail'

    | 'databases'

    | 'services'

    | 'deployments'

    | 'monitoring'

    | 'settings'

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

    { path: '/databases', label: 'Bases de données', description: 'Instances, sauvegardes et métriques.', icon: Database, page: 'databases' },

    { path: '/services', label: 'Services', description: 'Stacks et services gérés.', icon: Wrench, page: 'services' },

    { path: '/deployments', label: 'Déploiements', description: 'Files et historiques de livraison.', icon: Rocket, page: 'deployments' },

    { path: '/monitoring', label: 'Supervision', description: 'État et métriques système.', icon: Activity, page: 'monitoring' },

    { path: '/settings', label: 'Paramètres', description: 'Projets, serveurs, équipe et configuration.', icon: Settings, page: 'settings' },

    { path: '/agents', label: 'Agents IA', description: "Équipe d'agents autonomes DevForge.", icon: Bot, page: 'agents' },

];



export const staticRoutePaths = [

    ...appRoutes.map(({ path }) => path),

    ...settingsTabPaths.filter((path) => path !== '/settings'),

];



export function normalizeRoutePath(pathname: string): string {

    const withoutBase = pathname.startsWith(DEVFORGE_BASE_PATH)

        ? pathname.slice(DEVFORGE_BASE_PATH.length)

        : pathname;

    const normalized = `/${withoutBase}`.replace(/\/+/g, '/').replace(/\/$/, '');



    return normalized === '' ? '/' : normalized;

}



export function routeHref(path: string): string {

    return path === '/' ? `${DEVFORGE_BASE_PATH}/` : `${DEVFORGE_BASE_PATH}${path}/`;

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



const applicationsRoute = appRoutes[1];

const databasesRoute = appRoutes[2];

const servicesRoute = appRoutes[3];

const settingsRoute = appRoutes[6];

const agentsRoute = appRoutes[7];



const legacySettingsPaths: Array<{ pattern: RegExp; path: string }> = [

    { pattern: /^\/projects(?:\/.*)?$/, path: '/settings/projects' },

    { pattern: /^\/servers(?:\/.*)?$/, path: '/settings/servers' },

    { pattern: /^\/security(?:\/.*)?$/, path: '/settings/security' },

];



const dynamicRoutes: Array<{ pattern: RegExp; route: AppRoute }> = [

    { pattern: /^\/applications\/[^/]+(?:\/.*)?$/, route: { ...applicationsRoute, page: 'application-detail' } },

    { pattern: /^\/project\/[^/]+\/environment\/[^/]+\/application\/[^/]+(?:\/.*)?$/, route: applicationsRoute },

    { pattern: /^\/project\/[^/]+\/environment\/[^/]+\/database\/[^/]+(?:\/.*)?$/, route: databasesRoute },

    { pattern: /^\/project\/[^/]+\/environment\/[^/]+\/service\/[^/]+(?:\/.*)?$/, route: servicesRoute },

    { pattern: /^\/project\/[^/]+(?:\/.*)?$/, route: { ...settingsRoute, path: '/settings/projects' } },

    { pattern: /^\/server\/[^/]+(?:\/.*)?$/, route: { ...settingsRoute, path: '/settings/servers' } },

    { pattern: /^\/settings(?:\/.*)?$/, route: settingsRoute },

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

                ? normalizedPath

                : dynamicRoute.route.path;



            return {

                ...settingsRoute,

                path,

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


