import {
    Bot,
    Boxes,
    Gauge,
    HardDrive,
    Plug,
    Settings,
    type LucideIcon,
} from 'lucide-preact';
import type { PageKey } from './routes';

export type SidebarNavLink = {
    id: string;
    label: string;
    path: string;
    pages: PageKey[];
    icon?: LucideIcon;
    requiresAgents?: boolean;
};

export type SidebarNavGroup = {
    type: 'group';
    id: string;
    label: string;
    icon: LucideIcon;
    requiresAgents?: boolean;
    items: SidebarNavLink[];
};

export type SidebarNavItem = {
    type: 'link';
    id: string;
    label: string;
    path: string;
    icon: LucideIcon;
    pages: PageKey[];
    requiresAgents?: boolean;
};

export type SidebarNavEntry = SidebarNavItem | SidebarNavGroup;

/**
 * Navigation principale groupée — séparée de appRoutes (routage).
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
        type: 'group',
        id: 'applications',
        label: 'Applications',
        icon: Boxes,
        items: [
            {
                id: 'applications-manage',
                label: 'Gérer',
                path: '/applications',
                pages: ['applications', 'application-detail'],
            },
            {
                id: 'databases',
                label: 'Bases de données',
                path: '/databases',
                pages: ['databases'],
            },
            {
                id: 'services',
                label: 'Services',
                path: '/services',
                pages: ['services'],
            },
            {
                id: 'deployments',
                label: 'Cartographie',
                path: '/deployments',
                pages: ['deployments'],
            },
        ],
    },
    {
        type: 'group',
        id: 'infrastructure',
        label: 'Infrastructure',
        icon: HardDrive,
        items: [
            {
                id: 'storage',
                label: 'Stockage',
                path: '/storage',
                pages: ['storage', 'storages'],
            },
            {
                id: 'monitoring',
                label: 'Supervision',
                path: '/monitoring',
                pages: ['monitoring'],
            },
            {
                id: 'github-runners',
                label: 'Runners GitHub',
                path: '/github-runners',
                pages: ['github-runners'],
            },
            {
                id: 'scheduled-tasks',
                label: 'Tâches planifiées',
                path: '/scheduled-tasks',
                pages: ['scheduled-tasks'],
            },
        ],
    },
    {
        type: 'link',
        id: 'connexions',
        label: 'Tokens & Clés API',
        path: '/connexions',
        icon: Plug,
        pages: ['connexions', 'github', 'sources'],
    },
    {
        type: 'group',
        id: 'agents',
        label: 'Agents IA',
        icon: Bot,
        requiresAgents: true,
        items: [
            {
                id: 'agents-manage',
                label: 'Gérer',
                path: '/agents',
                pages: ['agents', 'agent-detail'],
            },
            {
                id: 'agents-settings',
                label: 'Paramètres AI',
                path: '/agents/settings',
                pages: ['agents-settings'],
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
            'shared-variables',
            'profile',
            'destinations',
            'tags',
            'subscription',
            'onboarding',
            'server-detail',
        ],
    },
];

export function visibleSidebarNav(agentsEnabled: boolean): SidebarNavEntry[] {
    return sidebarNav
        .map((entry) => {
            if (entry.type === 'link') {
                if (entry.requiresAgents && !agentsEnabled) {
                    return null;
                }

                return entry;
            }

            if (entry.requiresAgents && !agentsEnabled) {
                return null;
            }

            const items = entry.items.filter((item) => !item.requiresAgents || agentsEnabled);

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

export function isNavGroupActive(group: SidebarNavGroup, page: PageKey): boolean {
    return group.items.some((item) => isNavPageActive(item.pages, page));
}

/** Liens feuilles pour le mode barre réduite (icônes uniquement). */
export function flattenSidebarNav(entries: SidebarNavEntry[]): Array<SidebarNavLink & { icon: LucideIcon }> {
    const links: Array<SidebarNavLink & { icon: LucideIcon }> = [];

    for (const entry of entries) {
        if (entry.type === 'link') {
            links.push(entry);
            continue;
        }

        for (const item of entry.items) {
            links.push({
                ...item,
                icon: item.icon ?? entry.icon,
            });
        }
    }

    return links;
}
