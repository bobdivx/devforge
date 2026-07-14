export type ApplicationTabId =
    | 'overview'
    | 'deployments'
    | 'databases'
    | 'logs'
    | 'variables';

export type ApplicationTab = {
    id: ApplicationTabId;
    label: string;
};

export const applicationTabs: ApplicationTab[] = [
    { id: 'overview', label: 'Vue d’ensemble' },
    { id: 'deployments', label: 'Déploiements' },
    { id: 'databases', label: 'Bases de données' },
    { id: 'logs', label: 'Logs' },
    { id: 'variables', label: 'Variables' },
];
