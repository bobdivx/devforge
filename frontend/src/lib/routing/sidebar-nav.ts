import {
    Activity,
    Bot,
    Boxes,
    CalendarClock,
    Container,
    Cpu,
    Database,
    HardDrive,
    Home,
    MessageSquare,
    Plug,
    Rocket,
    Server,
    Settings,
    Sparkles,
    Store,
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
    hideWhenAgents?: boolean;
};

export type SidebarNavSection = {
    type: 'section';
    id: string;
    label: string;
    requiresAgents?: boolean;
    requiresInstanceAdmin?: boolean;
    hideWhenAgents?: boolean;
    items: SidebarNavLink[];
};

export type SidebarNavItem = {
    type: 'link';
} & SidebarNavLink;

export type SidebarNavEntry = SidebarNavItem | SidebarNavSection;

/**
 * Navigation PandaOS : Accueil, Apps, Assistant, Connexions, Réglages + Plus.
 */
export const sidebarNav: SidebarNavEntry[] = [
    {
        type: 'link',
        id: 'dashboard',
        label: 'Accueil',
        path: '/',
        icon: Home,
        pages: ['dashboard'],
    },
    {
        type: 'link',
        id: 'applications',
        label: 'Apps',
        path: '/applications',
        pages: ['applications', 'application-detail'],
        icon: Boxes,
    },
    {
        type: 'link',
        id: 'assistant',
        label: 'Assistant',
        path: '/agents/chat',
        pages: ['agents-chat', 'agent-detail'],
        icon: MessageSquare,
        requiresAgents: true,
    },
    {
        type: 'link',
        id: 'assistant-setup',
        label: 'Assistant',
        path: '/onboarding',
        pages: ['onboarding'],
        icon: Sparkles,
        hideWhenAgents: true,
    },
    {
        type: 'link',
        id: 'connexions',
        label: 'Connexions',
        path: '/connexions',
        icon: Plug,
        pages: ['connexions', 'github', 'sources', 'services'],
    },
    {
        type: 'link',
        id: 'settings',
        label: 'Réglages',
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
        ],
    },
    {
        type: 'section',
        id: 'plus',
        label: 'Plus',
        items: [
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
            {
                id: 'store',
                label: 'Store',
                path: '/store',
                pages: ['store'],
                icon: Store,
            },
            {
                id: 'agents-manage',
                label: 'Activité agents',
                path: '/agents',
                pages: ['agents'],
                icon: Bot,
                requiresAgents: true,
            },
            {
                id: 'automation',
                label: 'Automations',
                path: '/automation',
                pages: ['automation'],
                icon: Sparkles,
                requiresAgents: true,
            },
            {
                id: 'agents-settings',
                label: 'Configuration AI',
                path: '/agents/settings',
                pages: ['agents-settings'],
                icon: Settings,
                requiresAgents: true,
            },
        ],
    },
];

function isNavEntryVisible(
    entry: {
        requiresAgents?: boolean;
        requiresInstanceAdmin?: boolean;
        hideWhenAgents?: boolean;
    },
    agentsEnabled: boolean,
    instanceAdmin: boolean,
): boolean {
    if (entry.requiresAgents && !agentsEnabled) {
        return false;
    }

    if (entry.hideWhenAgents && agentsEnabled) {
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

export function primarySidebarNav(entries: SidebarNavEntry[]): SidebarNavLink[] {
    return entries.filter((entry): entry is SidebarNavItem => entry.type === 'link');
}

export function plusSidebarSection(entries: SidebarNavEntry[]): SidebarNavSection | null {
    const section = entries.find((entry) => entry.type === 'section' && entry.id === 'plus');

    return section && section.type === 'section' ? section : null;
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
