import { normalizeRoutePath } from './route-path';

export type SettingsTabId =
    | 'account'
    | 'projects'
    | 'servers'
    | 'team'
    | 'instance'
    | 'advanced'
    | 'email'
    | 'oauth'
    | 'updates'
    | 'backup'
    | 'scheduled-jobs'
    | 'notifications'
    | 'variables'
    | 'security'
    | 'storages'
    | 'ai';

export type SettingsTab = {
    id: SettingsTabId;
    label: string;
    path: string;
    requiresAgents?: boolean;
    requiresInstanceAdmin?: boolean;
};

export const settingsTabs: SettingsTab[] = [
    { id: 'account', label: 'Compte', path: '/settings' },
    { id: 'projects', label: 'Projets', path: '/settings/projects' },
    { id: 'servers', label: 'Serveurs', path: '/settings/servers' },
    { id: 'team', label: 'Équipe', path: '/settings/team' },
    { id: 'instance', label: 'Instance', path: '/settings/instance', requiresInstanceAdmin: true },
    { id: 'advanced', label: 'Avancé', path: '/settings/advanced', requiresInstanceAdmin: true },
    { id: 'email', label: 'E-mail', path: '/settings/email', requiresInstanceAdmin: true },
    { id: 'oauth', label: 'OAuth', path: '/settings/oauth', requiresInstanceAdmin: true },
    { id: 'updates', label: 'Mises à jour', path: '/settings/updates', requiresInstanceAdmin: true },
    { id: 'backup', label: 'Sauvegarde', path: '/settings/backup', requiresInstanceAdmin: true },
    { id: 'scheduled-jobs', label: 'Tâches planifiées', path: '/settings/scheduled-jobs', requiresInstanceAdmin: true },
    { id: 'notifications', label: 'Notifications', path: '/settings/notifications' },
    { id: 'variables', label: 'Variables', path: '/settings/variables' },
    { id: 'security', label: 'Sécurité', path: '/settings/security' },
    { id: 'storages', label: 'Stockage S3', path: '/settings/storages' },
    { id: 'ai', label: 'Intelligence artificielle', path: '/settings/ai', requiresAgents: true },
];

export const settingsTabPaths = settingsTabs.map(({ path }) => path);

export function visibleSettingsTabs(agentsEnabled: boolean, instanceAdmin: boolean): SettingsTab[] {
    return settingsTabs.filter(({ requiresAgents, requiresInstanceAdmin }) => {
        if (requiresAgents && !agentsEnabled) {
            return false;
        }

        if (requiresInstanceAdmin && !instanceAdmin) {
            return false;
        }

        return true;
    });
}

export type SettingsTabGroupId = 'personal' | 'organization' | 'infrastructure' | 'instance' | 'ai';

export type SettingsTabGroup = {
    id: SettingsTabGroupId;
    label: string;
    tabs: SettingsTab[];
};

const settingsTabGroupMeta: Array<{
    id: SettingsTabGroupId;
    label: string;
    requiresInstanceAdmin?: boolean;
    requiresAgents?: boolean;
}> = [
    { id: 'personal', label: 'Personnel' },
    { id: 'organization', label: 'Organisation' },
    { id: 'infrastructure', label: 'Infrastructure' },
    { id: 'instance', label: 'Instance', requiresInstanceAdmin: true },
    { id: 'ai', label: 'Intelligence artificielle', requiresAgents: true },
];

const tabGroupById: Record<SettingsTabId, SettingsTabGroupId> = {
    account: 'personal',
    projects: 'organization',
    team: 'organization',
    variables: 'organization',
    notifications: 'organization',
    servers: 'infrastructure',
    storages: 'infrastructure',
    security: 'infrastructure',
    instance: 'instance',
    advanced: 'instance',
    email: 'instance',
    oauth: 'instance',
    updates: 'instance',
    backup: 'instance',
    'scheduled-jobs': 'instance',
    ai: 'ai',
};

export function groupedVisibleSettingsTabs(
    agentsEnabled: boolean,
    instanceAdmin: boolean,
): SettingsTabGroup[] {
    const tabs = visibleSettingsTabs(agentsEnabled, instanceAdmin);

    return settingsTabGroupMeta
        .filter(({ requiresAgents, requiresInstanceAdmin }) => {
            if (requiresAgents && !agentsEnabled) {
                return false;
            }

            if (requiresInstanceAdmin && !instanceAdmin) {
                return false;
            }

            return true;
        })
        .map(({ id, label }) => ({
            id,
            label,
            tabs: tabs.filter((tab) => tabGroupById[tab.id] === id),
        }))
        .filter(({ tabs: groupTabs }) => groupTabs.length > 0);
}

export function parseSettingsTab(pathname: string): SettingsTabId {
    const normalized = normalizeRoutePath(pathname);

    if (normalized.startsWith('/notifications/')) {
        return 'notifications';
    }

    if (normalized.startsWith('/security/')) {
        return 'security';
    }

    if (normalized === '/profile' || normalized.startsWith('/profile/')) {
        return 'account';
    }

    if (normalized === '/team' || normalized.startsWith('/team/')) {
        return 'team';
    }

    const tab = settingsTabs.find(({ path }) => path === normalized);

    return tab?.id ?? 'account';
}

export function settingsTabPath(tabId: SettingsTabId): string {
    return settingsTabs.find(({ id }) => id === tabId)?.path ?? '/settings';
}

export function parseNotificationChannel(pathname: string): string | null {
    const normalized = normalizeRoutePath(pathname);
    const match = normalized.match(/^\/notifications\/([^/]+)/);

    return match?.[1] ?? null;
}

export function parseSecuritySection(pathname: string): 'keys' | 'cloud-tokens' | 'cloud-init-scripts' | 'api-tokens' {
    const normalized = normalizeRoutePath(pathname);

    if (normalized.startsWith('/security/cloud-tokens')) {
        return 'cloud-tokens';
    }

    if (normalized.startsWith('/security/cloud-init-scripts')) {
        return 'cloud-init-scripts';
    }

    if (normalized.startsWith('/security/api-tokens')) {
        return 'api-tokens';
    }

    return 'keys';
}

export function extractGithubAppUuid(pathname: string): string | null {
    const normalized = normalizeRoutePath(pathname);
    const match = normalized.match(/^\/(?:source\/github|connexions|github|sources)\/([^/]+)/);

    return match?.[1] ?? null;
}
