export type ApplicationTabId =
    | 'overview'
    | 'settings'
    | 'domains'
    | 'deployments'
    | 'previews'
    | 'databases'
    | 'logs'
    | 'variables'
    | 'files'
    | 'webhooks'
    | 'tasks'
    | 'storage'
    | 'limits'
    | 'danger';

export type ApplicationTab = {
    id: ApplicationTabId;
    label: string;
};

export const applicationTabs: ApplicationTab[] = [
    { id: 'overview', label: 'Vue d’ensemble' },
    { id: 'settings', label: 'Paramètres' },
    { id: 'domains', label: 'Domaines' },
    { id: 'deployments', label: 'Déploiements' },
    { id: 'previews', label: 'Previews' },
    { id: 'databases', label: 'Bases de données' },
    { id: 'tasks', label: 'Tâches' },
    { id: 'logs', label: 'Logs' },
    { id: 'variables', label: 'Variables' },
    { id: 'files', label: 'Code source' },
    { id: 'webhooks', label: 'Webhooks' },
    { id: 'storage', label: 'Storages' },
    { id: 'limits', label: 'Limites' },
    { id: 'danger', label: 'Danger' },
];

const applicationTabIds = new Set<string>(applicationTabs.map((tab) => tab.id));

const legacyApplicationSegmentToTab: Record<string, ApplicationTabId> = {
    '': 'overview',
    advanced: 'settings',
    swarm: 'settings',
    healthcheck: 'settings',
    servers: 'settings',
    'resource-limits': 'limits',
    limits: 'limits',
    'resource-operations': 'settings',
    'environment-variables': 'variables',
    source: 'files',
    webhooks: 'webhooks',
    'scheduled-tasks': 'tasks',
    tasks: 'tasks',
    deployment: 'deployments',
    logs: 'logs',
    danger: 'danger',
    'preview-deployments': 'previews',
    previews: 'previews',
    'persistent-storage': 'storage',
    storage: 'storage',
    storages: 'storage',
};

export function parseApplicationTab(value: string | null | undefined): ApplicationTabId {
    if (value && applicationTabIds.has(value)) {
        return value as ApplicationTabId;
    }

    return 'overview';
}

export function applicationTabFromLegacySegment(segment: string | undefined): ApplicationTabId {
    if (!segment) {
        return 'overview';
    }

    return legacyApplicationSegmentToTab[segment] ?? 'overview';
}

export function applicationPath(uuid: string, tab: ApplicationTabId = 'overview'): string {
    const base = `/applications/${uuid}`;

    return tab === 'overview' ? base : `${base}?tab=${tab}`;
}
