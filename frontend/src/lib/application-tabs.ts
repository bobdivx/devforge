export type ApplicationTabId =
    | 'overview'
    | 'settings'
    | 'domains'
    | 'deployments'
    | 'databases'
    | 'logs'
    | 'variables'
    | 'files'
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
    { id: 'databases', label: 'Bases de données' },
    { id: 'logs', label: 'Logs' },
    { id: 'variables', label: 'Variables' },
    { id: 'files', label: 'Code source' },
    { id: 'danger', label: 'Danger' },
];
