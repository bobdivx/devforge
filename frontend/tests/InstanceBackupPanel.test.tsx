import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InstanceBackupPanel } from '../src/components/storages/InstanceBackupPanel';
import { formatCron } from '../src/lib/cron-utils';
import type { InstanceBackupSettings } from '../src/lib/domain-api';
import { TeamContext } from '../src/lib/team-context';

function jsonResponse(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'content-type': 'application/json' },
    });
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

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
});

describe('InstanceBackupPanel', () => {
    it('affiche l’animation de progression après Lancer maintenant', async () => {
        const backupState = settings();
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
            const url = String(input);
            const method = init?.method ?? 'GET';

            if (url === '/sanctum/csrf-cookie') {
                return new Response(null, { status: 204 });
            }

            if (url === '/api/devforge/v1/settings/backup' && method === 'GET') {
                return jsonResponse({ data: backupState });
            }

            if (url === '/api/devforge/v1/settings/backup/run' && method === 'POST') {
                return jsonResponse({
                    data: {
                        queued: true,
                        backup_uuid: 'backup-1',
                        message: 'Sauvegarde d’instance mise en file d’attente.',
                    },
                });
            }

            throw new Error(`Requête inattendue : ${method} ${url}`);
        });

        render(
            <TeamContext.Provider value={{ teamId: 0, revision: 0, agentsEnabled: false }}>
                <InstanceBackupPanel />
            </TeamContext.Provider>,
        );

        expect(await screen.findByRole('heading', { name: 'Planification' })).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Lancer maintenant' }));

        expect(await screen.findByText('Sauvegarde d’instance en file d’attente…')).toBeInTheDocument();
        expect(document.querySelector('.cleanup-progress-bar')).not.toBeNull();
        expect(screen.queryByText('Sauvegarde d’instance mise en file d’attente.')).toBeNull();
        expect(screen.getByRole('button', { name: 'Sauvegarde…' })).toBeDisabled();

        await waitFor(() => {
            expect(fetchMock.mock.calls.some(([url, init]) => (
                String(url) === '/api/devforge/v1/settings/backup/run' && init?.method === 'POST'
            ))).toBe(true);
        });
    });

    it('affiche le message d’erreur des sauvegardes failed', async () => {
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
            const url = String(input);
            if (url === '/sanctum/csrf-cookie') {
                return new Response(null, { status: 204 });
            }

            if (url === '/api/devforge/v1/settings/backup') {
                return jsonResponse({
                    data: settings({
                        executions: [{
                            id: 2,
                            uuid: 'exec-failed',
                            status: 'failed',
                            message: 'Error response from daemon: No such container: coolify-db',
                            size: 0,
                            filename: null,
                            database_name: null,
                            s3_uploaded: null,
                            created_at: '2026-08-17T16:23:42+00:00',
                            finished_at: null,
                            download_url: null,
                        }],
                    }),
                });
            }

            throw new Error(`Requête inattendue : ${url}`);
        });

        render(
            <TeamContext.Provider value={{ teamId: 0, revision: 0, agentsEnabled: false }}>
                <InstanceBackupPanel />
            </TeamContext.Provider>,
        );

        expect(await screen.findByText('Échec')).toBeInTheDocument();
        expect(screen.getByText('Error response from daemon: No such container: coolify-db')).toBeInTheDocument();
        expect(screen.queryByText('2026-08-17T16:23:42+00:00')).toBeNull();
        expect(screen.getByRole('button', { name: 'Supprimer les échecs (1)' })).toBeInTheDocument();
    });

    it('affiche la fréquence en français', async () => {
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
            const url = String(input);
            if (url === '/sanctum/csrf-cookie') {
                return new Response(null, { status: 204 });
            }

            if (url === '/api/devforge/v1/settings/backup') {
                return jsonResponse({ data: settings() });
            }

            throw new Error(`Requête inattendue : ${url}`);
        });

        render(
            <TeamContext.Provider value={{ teamId: 0, revision: 0, agentsEnabled: false }}>
                <InstanceBackupPanel />
            </TeamContext.Provider>,
        );

        expect(await screen.findByText(formatCron('0 0 * * *'))).toBeInTheDocument();
        expect(screen.getByText('0 0 * * *')).toBeInTheDocument();
    });

    it('supprime une exécution en échec après confirmation', async () => {
        const backupState = settings({
            executions: [{
                id: 2,
                uuid: 'exec-failed',
                status: 'failed',
                message: 'No such container: coolify-db',
                size: 0,
                filename: null,
                database_name: null,
                s3_uploaded: null,
                created_at: '2026-08-17T16:23:42+00:00',
                finished_at: null,
                download_url: null,
            }],
        });
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
            const url = String(input);
            const method = init?.method ?? 'GET';

            if (url === '/sanctum/csrf-cookie') {
                return new Response(null, { status: 204 });
            }

            if (url === '/api/devforge/v1/settings/backup' && method === 'GET') {
                return jsonResponse({ data: backupState });
            }

            if (url.includes('/api/devforge/v1/settings/backup/executions/exec-failed') && method === 'DELETE') {
                backupState.executions = [];
                return jsonResponse({ data: backupState });
            }

            throw new Error(`Requête inattendue : ${method} ${url}`);
        });

        render(
            <TeamContext.Provider value={{ teamId: 0, revision: 0, agentsEnabled: false }}>
                <InstanceBackupPanel />
            </TeamContext.Provider>,
        );

        expect(await screen.findByText('Échec')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Supprimer cette sauvegarde' }));
        fireEvent.click(screen.getByRole('button', { name: 'Supprimer' }));

        await waitFor(() => {
            expect(fetchMock.mock.calls.some(([url, init]) => (
                String(url).includes('/settings/backup/executions/exec-failed') && init?.method === 'DELETE'
            ))).toBe(true);
        });
    });

    it('affiche un dump S3 uniquement sans le chemin local', async () => {
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
            const url = String(input);
            if (url === '/sanctum/csrf-cookie') {
                return new Response(null, { status: 204 });
            }

            if (url === '/api/devforge/v1/settings/backup') {
                return jsonResponse({
                    data: settings({
                        backup: {
                            uuid: 'backup-1',
                            enabled: true,
                            frequency: '0 0 * * *',
                            save_s3: true,
                            disable_local_backup: true,
                            s3_storage: { uuid: 's3-1', name: 'scaleway' },
                        },
                        executions: [{
                            id: 5,
                            uuid: 'exec-s3',
                            status: 'success',
                            message: null,
                            size: 3232086,
                            filename: '/media/Docker/AppData/devforge/data/backups/coolify/devforge-db-hostdockerinternal/pg-dump-devforge-1786985338.dmp',
                            database_name: null,
                            s3_uploaded: true,
                            local_storage_deleted: true,
                            created_at: '2026-08-17T16:48:58+00:00',
                            finished_at: null,
                            download_url: null,
                        }],
                    }),
                });
            }

            throw new Error(`Requête inattendue : ${url}`);
        });

        render(
            <TeamContext.Provider value={{ teamId: 0, revision: 0, agentsEnabled: false }}>
                <InstanceBackupPanel />
            </TeamContext.Provider>,
        );

        expect(await screen.findByText('pg-dump-devforge-1786985338.dmp')).toBeInTheDocument();
        expect(screen.getByText('S3 uniquement · scaleway')).toBeInTheDocument();
        expect(screen.queryByText(/\/media\/Docker/)).toBeNull();
        expect(screen.queryByRole('link', { name: 'Télécharger' })).toBeNull();
    });
});
