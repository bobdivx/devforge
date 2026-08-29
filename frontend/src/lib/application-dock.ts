import type { ApplicationTabId } from './application-tabs';

export type ApplicationDockTabId = Extract<
    ApplicationTabId,
    'agents' | 'deployments' | 'logs' | 'variables' | 'settings'
>;

export type ApplicationDockItem = {
    id: ApplicationDockTabId;
    label: string;
};

export const applicationDockItems: ApplicationDockItem[] = [
    { id: 'agents', label: 'Chat' },
    { id: 'deployments', label: 'Déploiements' },
    { id: 'logs', label: 'Logs' },
    { id: 'variables', label: 'Env' },
    { id: 'settings', label: 'Réglages' },
];
