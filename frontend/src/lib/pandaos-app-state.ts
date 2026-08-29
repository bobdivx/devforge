import { resourceStatusPrimary } from './core-resource-actions';
import type { CoreAction, ResourceStatus } from './domain-api';

export type PandaAppState = 'stopped' | 'starting' | 'running' | 'error' | 'idle';

export function pandaAppState(status: ResourceStatus['status'] | string): PandaAppState {
    const primary = resourceStatusPrimary(typeof status === 'string' ? status : 'unknown');

    if (primary === 'running' || primary === 'degraded') {
        return 'running';
    }

    if (primary === 'starting' || primary === 'created' || primary === 'restarting') {
        return 'starting';
    }

    if (primary === 'exited' || primary === 'stopped' || primary === 'dead' || primary === 'paused') {
        return 'stopped';
    }

    if (primary.includes('fail') || primary === 'error' || primary === 'unavailable') {
        return 'error';
    }

    return 'idle';
}

export function pandaAppStateLabel(state: PandaAppState): string {
    if (state === 'running') {
        return 'Actif';
    }

    if (state === 'starting') {
        return 'Démarrage';
    }

    if (state === 'stopped') {
        return 'Arrêté';
    }

    if (state === 'error') {
        return 'Erreur';
    }

    return 'Inactif';
}

export function pandaAppDotClass(state: PandaAppState): string {
    if (state === 'running') {
        return 'bg-success';
    }

    if (state === 'starting') {
        return 'bg-warning animate-pulse';
    }

    if (state === 'error') {
        return 'bg-error';
    }

    return 'bg-base-content/30';
}

export function pandaAppActions(state: PandaAppState): CoreAction[] {
    if (state === 'stopped' || state === 'idle') {
        return ['start'];
    }

    if (state === 'starting') {
        return ['stop'];
    }

    if (state === 'running') {
        return ['stop', 'restart'];
    }

    return ['restart'];
}

export const pandaActionLabels: Record<CoreAction, string> = {
    start: 'Démarrer',
    stop: 'Arrêter',
    restart: 'Redémarrer',
    deploy: 'Déployer',
};
