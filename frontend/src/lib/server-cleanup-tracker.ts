import type { ServerStorageExecution } from './domain-api';

export type ServerCleanupPhase = 'queued' | 'running' | 'completed' | 'failed' | 'timeout';

const TERMINAL_STATUSES = new Set(['success', 'failed']);

export function isTerminalCleanupStatus(status: string | null | undefined): boolean {
    return status != null && TERMINAL_STATUSES.has(status);
}

export function resolveCleanupPhase(execution: ServerStorageExecution | null | undefined): ServerCleanupPhase {
    if (!execution) {
        return 'queued';
    }

    if (execution.status === 'running') {
        return execution.message?.includes('file') ? 'queued' : 'running';
    }

    if (execution.status === 'success') {
        return 'completed';
    }

    if (execution.status === 'failed') {
        return 'failed';
    }

    return 'running';
}

export function cleanupPhaseLabel(phase: ServerCleanupPhase): string {
    switch (phase) {
        case 'queued':
            return 'Nettoyage en file d’attente…';
        case 'running':
            return 'Nettoyage Docker en cours…';
        case 'completed':
            return 'Nettoyage terminé';
        case 'failed':
            return 'Nettoyage échoué';
        case 'timeout':
            return 'Suivi interrompu (délai dépassé)';
    }
}
