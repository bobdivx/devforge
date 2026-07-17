import { normalizeRoutePath } from './route-path';

export type SharedVariableScopeTab = 'overview' | 'team' | 'project' | 'environment' | 'server';

export type SharedVariableScopeTabDef = {
    id: SharedVariableScopeTab;
    label: string;
    description: string;
    path: string;
};

export const sharedVariableScopeTabs: SharedVariableScopeTabDef[] = [
    {
        id: 'overview',
        label: 'Vue d’ensemble',
        description: 'Choisir une portée pour parcourir les variables.',
        path: '/shared-variables',
    },
    {
        id: 'team',
        label: 'Équipe',
        description: 'Variables utilisables par toutes les ressources de l’équipe.',
        path: '/shared-variables/team',
    },
    {
        id: 'project',
        label: 'Projet',
        description: 'Variables limitées à un projet.',
        path: '/shared-variables/projects',
    },
    {
        id: 'environment',
        label: 'Environnement',
        description: 'Variables limitées à un environnement.',
        path: '/shared-variables/environments',
    },
    {
        id: 'server',
        label: 'Serveur',
        description: 'Variables limitées à un serveur.',
        path: '/shared-variables/servers',
    },
];

export const sharedVariablesStaticPaths = sharedVariableScopeTabs.map(({ path }) => path);

export function parseSharedVariableScope(pathname: string): SharedVariableScopeTab {
    const normalized = normalizeRoutePath(pathname);

    if (normalized === '/settings/variables') {
        return 'team';
    }

    if (normalized === '/shared-variables') {
        return 'overview';
    }

    if (normalized.startsWith('/shared-variables/team')) {
        return 'team';
    }

    if (normalized.startsWith('/shared-variables/project')) {
        return 'project';
    }

    if (normalized.startsWith('/shared-variables/environment')) {
        return 'environment';
    }

    if (normalized.startsWith('/shared-variables/server')) {
        return 'server';
    }

    return 'overview';
}

export function sharedVariableScopePath(tabId: SharedVariableScopeTab): string {
    return sharedVariableScopeTabs.find(({ id }) => id === tabId)?.path ?? '/shared-variables';
}
