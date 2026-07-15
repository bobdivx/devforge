export type ApplicationTabId =
    | 'overview'
    | 'deployments'
    | 'databases'
    | 'logs'
    | 'variables'
    | 'files';

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
    { id: 'files', label: 'Code source' },
];
