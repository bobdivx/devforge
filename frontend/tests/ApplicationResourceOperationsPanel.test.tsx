import { cleanup, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApplicationResourceOperationsPanel } from '../src/components/applications/ApplicationResourceOperationsPanel';

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

describe('ApplicationResourceOperationsPanel', () => {
    it('affiche les options de clone et de déplacement', async () => {
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
            const url = String(input);
            if (url.includes('/resource-operations')) {
                return jsonResponse({
                    data: {
                        current_destination_uuid: 'dest-1',
                        current_environment_uuid: 'env-1',
                        destinations: [
                            {
                                uuid: 'dest-1',
                                name: 'coolify',
                                type: 'standalone',
                                server: { uuid: 'srv-1', name: 'localhost' },
                            },
                        ],
                        environments: [
                            {
                                uuid: 'env-1',
                                name: 'production',
                                project_uuid: 'proj-1',
                                project_name: 'Demo',
                            },
                            {
                                uuid: 'env-2',
                                name: 'staging',
                                project_uuid: 'proj-1',
                                project_name: 'Demo',
                            },
                        ],
                    },
                });
            }

            return jsonResponse({ message: 'not found' }, 404);
        });

        render(<ApplicationResourceOperationsPanel applicationUuid="app-1" canAct />);

        await waitFor(() => {
            expect(screen.getByText('Opérations sur la ressource')).toBeTruthy();
            expect(screen.getByText('Copier aussi les données des volumes')).toBeTruthy();
            expect(screen.getByText('Environnement cible')).toBeTruthy();
        });
    });
});
