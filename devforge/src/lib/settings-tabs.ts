import { normalizeRoutePath } from './routes';

export type SettingsTabId =
    | 'account'
    | 'projects'
    | 'servers'
    | 'team'
    | 'instance'
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
};

export const settingsTabs: SettingsTab[] = [
    { id: 'account', label: 'Compte', path: '/settings' },
    { id: 'projects', label: 'Projets', path: '/settings/projects' },
    { id: 'servers', label: 'Serveurs', path: '/settings/servers' },
    { id: 'team', label: 'Équipe', path: '/settings/team' },
    { id: 'instance', label: 'Instance', path: '/settings/instance' },
    { id: 'notifications', label: 'Notifications', path: '/settings/notifications' },
    { id: 'variables', label: 'Variables', path: '/settings/variables' },
    { id: 'security', label: 'Sécurité', path: '/settings/security' },
    { id: 'storages', label: 'Stockage S3', path: '/settings/storages' },
    { id: 'ai', label: 'Intelligence artificielle', path: '/settings/ai', requiresAgents: true },
];

export const settingsTabPaths = settingsTabs.map(({ path }) => path);

export function visibleSettingsTabs(agentsEnabled: boolean): SettingsTab[] {
    return settingsTabs.filter(({ requiresAgents }) => !requiresAgents || agentsEnabled);
}

export function parseSettingsTab(pathname: string): SettingsTabId {
    const normalized = normalizeRoutePath(pathname);
    const tab = settingsTabs.find(({ path }) => path === normalized);

    return tab?.id ?? 'account';
}

export function settingsTabPath(tabId: SettingsTabId): string {
    return settingsTabs.find(({ id }) => id === tabId)?.path ?? '/settings';
}
