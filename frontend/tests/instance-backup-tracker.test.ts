import { describe, expect, it } from 'vitest';
import {
    findTrackedInstanceBackupExecution,
    instanceBackupFileName,
    instanceBackupLocationLabel,
    instanceBackupPhaseLabel,
    isTerminalBackupStatus,
    pickActiveInstanceBackupExecution,
    resolveInstanceBackupPhase,
} from '../src/lib/instance-backup-tracker';
import type { InstanceBackupExecution, InstanceBackupSettings } from '../src/lib/domain-api';

function execution(overrides: Partial<InstanceBackupExecution> = {}): InstanceBackupExecution {
    return {
        id: 1,
        uuid: 'exec-1',
        status: 'running',
        message: null,
        size: 0,
        filename: null,
        database_name: null,
        s3_uploaded: null,
        created_at: '2026-08-17T16:00:00.000Z',
        finished_at: null,
        download_url: null,
        ...overrides,
    };
}

function settings(overrides: Partial<InstanceBackupSettings> = {}): InstanceBackupSettings {
    return {
        database: {
            uuid: 'db-1',
            name: 'coolify-db',
            description: null,
            postgres_user: 'devforge',
            status: 'running',
        },
        backup: {
            uuid: 'backup-1',
            enabled: true,
            frequency: '0 0 * * *',
            save_s3: false,
            s3_storage: null,
        },
        executions: [],
        s3_storages: [],
        is_server_functional: true,
        migration: {
            legacy_container_detected: false,
            container_candidates: ['devforge-db'],
            notes: '',
        },
        ...overrides,
    };
}

describe('instance backup tracker', () => {
    it('détecte les statuts terminaux', () => {
        expect(isTerminalBackupStatus('success')).toBe(true);
        expect(isTerminalBackupStatus('failed')).toBe(true);
        expect(isTerminalBackupStatus('running')).toBe(false);
        expect(isTerminalBackupStatus(null)).toBe(false);
    });

    it('garde une exécution réussie hors du suivi actif', () => {
        expect(pickActiveInstanceBackupExecution(settings({
            executions: [execution({ status: 'success' })],
        }))).toBeNull();
    });

    it('reprend une exécution encore running', () => {
        const active = execution({ uuid: 'running-1', status: 'running' });
        expect(pickActiveInstanceBackupExecution(settings({
            backup: {
                uuid: 'backup-1',
                enabled: true,
                frequency: '0 0 * * *',
                save_s3: false,
                s3_storage: null,
                latest_execution: active,
            },
            executions: [active],
        }))?.uuid).toBe('running-1');
    });

    it('ignore les anciennes exécutions déjà connues tant que le job n’a pas démarré', () => {
        const previous = execution({ uuid: 'old-success', status: 'success' });
        expect(findTrackedInstanceBackupExecution(
            settings({ executions: [previous] }),
            new Set(['old-success']),
        )).toBeNull();
    });

    it('suit la nouvelle exécution dès qu’elle apparaît', () => {
        const previous = execution({ uuid: 'old-success', status: 'success' });
        const current = execution({ uuid: 'new-running', status: 'running' });
        expect(findTrackedInstanceBackupExecution(
            settings({ executions: [current, previous] }),
            new Set(['old-success']),
        )?.uuid).toBe('new-running');
    });

    it('résout les phases et libellés français', () => {
        expect(resolveInstanceBackupPhase(null)).toBe('queued');
        expect(resolveInstanceBackupPhase(execution({ status: 'running' }))).toBe('running');
        expect(resolveInstanceBackupPhase(execution({ status: 'success' }))).toBe('completed');
        expect(instanceBackupPhaseLabel('queued')).toContain('file d’attente');
        expect(instanceBackupPhaseLabel('running')).toContain('en cours');
    });

    it('affiche un dump S3 uniquement sans le chemin NAS', () => {
        const dump = '/media/Docker/AppData/devforge/data/backups/coolify/devforge-db-hostdockerinternal/pg-dump-devforge-1786985338.dmp';

        expect(instanceBackupFileName(dump)).toBe('pg-dump-devforge-1786985338.dmp');
        expect(instanceBackupLocationLabel(execution({
            filename: dump,
            s3_uploaded: true,
            local_storage_deleted: true,
        }), 'scaleway')).toBe('S3 uniquement · scaleway');
    });
});
