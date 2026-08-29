import type { ApplicationTabId } from './application-tabs';

export type ApplicationDockItem = {
    id: ApplicationTabId;
    label: string;
};

export const applicationDockItems: ApplicationDockItem[] = [
    { id: 'agents', label: 'Chat' },
    { id: 'deployments', label: 'Déploiements' },
    { id: 'logs', label: 'Logs' },
    { id: 'variables', label: 'Env' },
    { id: 'settings', label: 'Réglages' },
];
