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

export type ApplicationTabGroup = {
    id: string;
    label: string;
    items: ApplicationTab[];
};

export const applicationTabGroups: ApplicationTabGroup[] = [
    {
        id: 'health',
        label: 'Santé',
        items: [
            { id: 'overview', label: 'Vue d’ensemble' },
            { id: 'deployments', label: 'Déploiements' },
            { id: 'logs', label: 'Logs' },
            { id: 'previews', label: 'Previews' },
        ],
    },
    {
        id: 'connect',
        label: 'Connexions',
        items: [
            { id: 'domains', label: 'Domaines' },
            { id: 'databases', label: 'Bases de données' },
            { id: 'variables', label: 'Variables' },
            { id: 'files', label: 'Code source' },
        ],
    },
    {
        id: 'configure',
        label: 'Configuration',
        items: [
            { id: 'settings', label: 'Paramètres' },
            { id: 'tasks', label: 'Tâches' },
            { id: 'webhooks', label: 'Webhooks' },
            { id: 'storage', label: 'Storages' },
            { id: 'limits', label: 'Limites' },
        ],
    },
    {
        id: 'danger',
        label: 'Zone sensible',
        items: [
            { id: 'danger', label: 'Danger' },
        ],
    },
];

export const applicationTabs: ApplicationTab[] = applicationTabGroups.flatMap((group) => group.items);

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
