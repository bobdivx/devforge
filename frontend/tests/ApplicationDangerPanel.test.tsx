import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApplicationDangerPanel } from '../src/components/applications/ApplicationDangerPanel';

function jsonResponse(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('ApplicationDangerPanel', () => {
    it('affiche la zone danger avec reset DB et suppression', async () => {
        let deleted = false;
        let resetCalled = false;
        const onDeleted = vi.fn(async () => undefined);

        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
            const url = String(input);
            const method = (init?.method ?? 'GET').toUpperCase();

            if (url.includes('/sanctum/csrf-cookie')) {
                return new Response(null, { status: 204 });
            }

            if (url.includes('/databases/') && url.includes('/reset') && method === 'POST') {
                resetCalled = true;
                return jsonResponse({
                    data: {
                        database_uuid: 'db-1',
                        database_name: 'macompta-db',
                        reset: true,
                        restarted: true,
                        message: 'Base vidée et redémarrée.',
                        redeploy: {
                            queued: true,
                            deployment_uuid: 'deploy-reset-1',
                            message: 'Deployment queued.',
                        },
                    },
                });
            }

            if (url.includes('/applications/app-uuid-1234') && method === 'DELETE') {
                deleted = true;
                return jsonResponse({ data: { queued: true, message: 'Suppression planifiée.' } });
            }

            if (url.includes('/linkable-databases')) {
                return jsonResponse({
                    data: [{
                        uuid: 'db-1',
                        name: 'macompta-db',
                        engine: 'libsql',
                        status: 'running',
                        default_env_key: 'TURSO_DATABASE_URL',
                        connected_applications: [],
                        is_linkable: false,
                    }],
                    meta: {
                        connections: [{
                            database_uuid: 'db-1',
                            env_keys: ['TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN'],
                            is_runtime: true,
                            is_buildtime: true,
                            updated_at: null,
                        }],
                        turso_migration: null,
                    },
                });
            }

            throw new Error(`URL inattendue : ${url}`);
        });

        render(
            <ApplicationDangerPanel
                applicationUuid="app-uuid-1234"
                applicationName="macompta"
                canAct
                onDeleted={onDeleted}
            />,
        );

        expect(await screen.findByText('Zone dangereuse')).toBeInTheDocument();
        expect(screen.getByText('macompta-db')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Reset DB' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Supprimer l’application' })).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Reset DB' }));
        expect(await screen.findByText(/Vider définitivement/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Confirmer' }));

        await waitFor(() => {
            expect(resetCalled).toBe(true);
            expect(screen.getByText(/Base vidée/)).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole('button', { name: 'Supprimer l’application' }));
        expect(await screen.findByText(/Supprimer définitivement « macompta »/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Confirmer' }));

        await waitFor(() => {
            expect(deleted).toBe(true);
            expect(onDeleted).toHaveBeenCalled();
        });
    });
});
