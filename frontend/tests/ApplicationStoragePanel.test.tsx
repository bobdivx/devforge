import { cleanup, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApplicationStoragePanel } from '../src/components/applications/ApplicationStoragePanel';

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

describe('ApplicationStoragePanel', () => {
    it('affiche la liste des storages', async () => {
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
            const url = String(input);
            if (url.includes('/storages')) {
                return jsonResponse({
                    data: {
                        compose_managed: false,
                        is_swarm: false,
                        storages: [
                            {
                                uuid: 'vol-1',
                                type: 'persistent',
                                name: 'app-uuid-data',
                                mount_path: '/app/data',
                                host_path: null,
                                is_preview_suffix_enabled: true,
                                read_only: false,
                                created_at: null,
                                updated_at: null,
                            },
                        ],
                    },
                });
            }

            return jsonResponse({ message: 'not found' }, 404);
        });

        render(<ApplicationStoragePanel resourceType="applications" resourceUuid="app-uuid" canAct />);

        await waitFor(() => {
            expect(screen.getByText('Volume')).toBeTruthy();
            expect(screen.getByText('data')).toBeTruthy();
            expect(screen.getByText('/app/data')).toBeTruthy();
        });
    });
});
