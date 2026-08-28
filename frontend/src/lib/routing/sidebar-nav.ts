import {
    Activity,
    Bot,
    Boxes,
    CalendarClock,
    Container,
    Cpu,
    Database,
    Gauge,
    HardDrive,
    MessageSquare,
    Plug,
    Rocket,
    Server,
    Settings,
    Sparkles,
    Store,
    Info,
    Wrench,
    type LucideIcon,
} from 'lucide-preact';
import type { AppRoute, PageKey } from './routes';

export type SidebarNavLink = {
    id: string;
    label: string;
    path: string;
    pages: PageKey[];
    icon: LucideIcon;
    requiresAgents?: boolean;
    requiresInstanceAdmin?: boolean;
};

export type SidebarNavSection = {
    type: 'section';
    id: string;
    label: string;
    requiresAgents?: boolean;
    requiresInstanceAdmin?: boolean;
    items: SidebarNavLink[];
};

export type SidebarNavItem = {
    type: 'link';
} & SidebarNavLink;

export type SidebarNavEntry = SidebarNavItem | SidebarNavSection;

/**
 * Navigation principale organisée par les 3 jobs de DevForge :
 * 1. Déployer les apps
 * 2. Correction/amélioration automatique via agents
 * 3. Continuer à développer sur DevForge
 */
export const sidebarNav: SidebarNavEntry[] = [
    {
        type: 'link',
        id: 'dashboard',
        label: "Vue d'ensemble",
        path: '/',
        icon: Gauge,
        pages: ['dashboard'],
    },
    {
        type: 'section',
        id: 'deploy',
        label: 'Déployer',
        items: [
            {
                id: 'applications',
                label: 'Applications',
                path: '/applications',
                pages: ['applications', 'application-detail'],
                icon: Boxes,
            },
            {
                id: 'deployments',
                label: 'Déploiements',
                path: '/deployments',
                pages: ['deployments'],
                icon: Rocket,
            },
            {
                id: 'databases',
                label: 'Bases de données',
                path: '/databases',
                pages: ['databases'],
                icon: Database,
            },
            {
                id: 'services',
                label: 'Connexions',
                path: '/services',
                pages: ['connexions', 'services'],
                icon: Wrench,
            },
        ],
    },
    {
        type: 'section',
        id: 'agents',
        label: 'Équipe IA',
        requiresAgents: true,
        items: [
            {
                id: 'agents-manage',
                label: 'Activité & membres',
                path: '/agents',
                pages: ['agents'],
                icon: Bot,
            },
            {
                id: 'agents-chat',
                label: 'Chat',
                path: '/agents/chat',
                pages: ['agents-chat', 'agent-detail'],
                icon: MessageSquare,
            },
            {
                id: 'automation',
                label: 'Automations',
                path: '/automation',
                pages: ['automation'],
                icon: Sparkles,
            },
        ],
    },
    {
        type: 'section',
        id: 'operations',
        label: 'Infrastructure',
        items: [
            {
                id: 'docker',
                label: 'Docker',
                path: '/docker',
                pages: ['docker'],
                icon: Container,
            },
            {
                id: 'monitoring',
                label: 'Supervision',
                path: '/monitoring',
                pages: ['monitoring'],
                icon: Activity,
            },
            {
                id: 'storage',
                label: 'Stockage',
                path: '/storage',
                pages: ['storage', 'storages'],
                icon: HardDrive,
            },
            {
                id: 'servers',
                label: 'Serveurs',
                path: '/settings/servers',
                pages: ['server-detail'],
                icon: Server,
            },
            {
                id: 'github-runners',
                label: 'Runners GitHub',
                path: '/github-runners',
                pages: ['github-runners'],
                icon: Cpu,
            },
            {
                id: 'scheduled-tasks',
                label: 'Tâches planifiées',
                path: '/scheduled-tasks',
                pages: ['scheduled-tasks'],
                icon: CalendarClock,
            },
        ],
    },
    {
        type: 'link',
        id: 'connexions',
        label: 'Connexions',
        path: '/connexions',
        icon: Plug,
        pages: ['connexions', 'github', 'sources'],
    },
    {
        type: 'link',
        id: 'store',
        label: 'Store',
        path: '/store',
        icon: Store,
        pages: ['store'],
    },
    {
        type: 'link',
        id: 'about',
        label: 'À propos',
        path: '/a-propos',
        icon: Info,
        pages: ['about'],
    },
    {
        type: 'section',
        id: 'ai-settings',
        label: 'Paramètres IA',
        requiresAgents: true,
        items: [
            {
                id: 'agents-settings',
                label: 'Configuration AI',
                path: '/agents/settings',
                pages: ['agents-settings'],
                icon: Settings,
            },
        ],
    },
    {
        type: 'link',
        id: 'settings',
        label: 'Paramètres',
        path: '/settings',
        icon: Settings,
        pages: [
            'settings',
            'sso',
            'shared-variables',
            'profile',
            'destinations',
            'tags',
            'subscription',
            'onboarding',
        ],
    },
];

function isNavEntryVisible(
    entry: { requiresAgents?: boolean; requiresInstanceAdmin?: boolean },
    agentsEnabled: boolean,
    instanceAdmin: boolean,
): boolean {
    if (entry.requiresAgents && !agentsEnabled) {
        return false;
    }

    if (entry.requiresInstanceAdmin && !instanceAdmin) {
        return false;
    }

    return true;
}

export function visibleSidebarNav(agentsEnabled: boolean, instanceAdmin = false): SidebarNavEntry[] {
    return sidebarNav
        .map((entry) => {
            if (entry.type === 'link') {
                if (!isNavEntryVisible(entry, agentsEnabled, instanceAdmin)) {
                    return null;
                }

                return entry;
            }

            if (!isNavEntryVisible(entry, agentsEnabled, instanceAdmin)) {
                return null;
            }

            const items = entry.items.filter((item) => isNavEntryVisible(item, agentsEnabled, instanceAdmin));

            if (items.length === 0) {
                return null;
            }

            return { ...entry, items };
        })
        .filter((entry): entry is SidebarNavEntry => entry !== null);
}

export function isNavPageActive(pages: PageKey[], page: PageKey): boolean {
    return pages.includes(page);
}

export function isNavSectionActive(section: SidebarNavSection, page: PageKey): boolean {
    return section.items.some((item) => isNavPageActive(item.pages, page));
}

/** @deprecated Utiliser isNavSectionActive */
export const isNavGroupActive = isNavSectionActive;

export function flattenSidebarNav(entries: SidebarNavEntry[]): SidebarNavLink[] {
    const links: SidebarNavLink[] = [];

    for (const entry of entries) {
        if (entry.type === 'link') {
            links.push(entry);
            continue;
        }

        links.push(...entry.items);
    }

    return links;
}

export function navPathMatches(itemPath: string, routePath: string): boolean {
    if (itemPath === '/') {
        return routePath === '/';
    }

    return routePath === itemPath || routePath.startsWith(`${itemPath}/`);
}

export function resolveActiveNavId(entries: SidebarNavEntry[], route: AppRoute): string | null {
    const links = flattenSidebarNav(entries);
    const pathHits = links.filter((item) => navPathMatches(item.path, route.path));

    if (pathHits.length > 0) {
        return [...pathHits].sort((left, right) => right.path.length - left.path.length)[0]?.id ?? null;
    }

    const pageHits = links.filter((item) => item.pages.includes(route.page));

    if (pageHits.length > 0) {
        return [...pageHits].sort((left, right) => right.path.length - left.path.length)[0]?.id ?? null;
    }

    return null;
}
