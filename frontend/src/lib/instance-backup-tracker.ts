import type { InstanceBackupExecution, InstanceBackupSettings } from './domain-api';

export type InstanceBackupPhase = 'queued' | 'running' | 'completed' | 'failed' | 'timeout';

const TERMINAL_STATUSES = new Set(['success', 'failed']);

export function isTerminalBackupStatus(status: string | null | undefined): boolean {
    return status != null && TERMINAL_STATUSES.has(status);
}

export function pickActiveInstanceBackupExecution(
    settings: InstanceBackupSettings | null | undefined,
): InstanceBackupExecution | null {
    const latest = settings?.backup?.latest_execution ?? settings?.executions[0] ?? null;
    if (latest && !isTerminalBackupStatus(latest.status)) {
        return latest;
    }

    return null;
}

export function findTrackedInstanceBackupExecution(
    settings: InstanceBackupSettings,
    knownUuids: ReadonlySet<string>,
): InstanceBackupExecution | null {
    const newest = settings.executions.find((execution) => !knownUuids.has(execution.uuid))
        ?? (settings.backup?.latest_execution && !knownUuids.has(settings.backup.latest_execution.uuid)
            ? settings.backup.latest_execution
            : null);

    return newest ?? pickActiveInstanceBackupExecution(settings);
}

export function resolveInstanceBackupPhase(
    execution: InstanceBackupExecution | null | undefined,
): InstanceBackupPhase {
    if (!execution) {
        return 'queued';
    }

    if (execution.status === 'running' || execution.status == null || execution.status === '') {
        return 'running';
    }

    if (execution.status === 'success') {
        return 'completed';
    }

    if (execution.status === 'failed') {
        return 'failed';
    }

    return 'running';
}

export function instanceBackupFileName(filename: string | null | undefined): string {
    if (!filename) {
        return '—';
    }

    const parts = filename.split(/[\\/]/).filter(Boolean);

    return parts[parts.length - 1] ?? filename;
}

export function instanceBackupLocationLabel(execution: InstanceBackupExecution, s3Name?: string | null): string {
    if (execution.s3_uploaded && execution.local_storage_deleted) {
        return s3Name ? `S3 uniquement · ${s3Name}` : 'S3 uniquement';
    }

    if (execution.s3_uploaded) {
        return s3Name ? `S3 + local · ${s3Name}` : 'S3 + local';
    }

    return 'Local';
}

export function instanceBackupPhaseLabel(phase: InstanceBackupPhase): string {
    switch (phase) {
        case 'queued':
            return 'Sauvegarde d’instance en file d’attente…';
        case 'running':
            return 'Sauvegarde d’instance en cours…';
        case 'completed':
            return 'Sauvegarde d’instance terminée';
        case 'failed':
            return 'Sauvegarde d’instance échouée';
        case 'timeout':
            return 'Suivi interrompu (délai dépassé)';
    }
}
