import { cleanup, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServiceStoragePanel } from '../src/components/services/ServiceStoragePanel';

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

describe('ServiceStoragePanel', () => {
    it('affiche les storages groupés par enfant', async () => {
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
            const url = String(input);
            if (url.includes('/storages')) {
                return jsonResponse({
                    data: {
                        compose_managed: true,
                        is_swarm: false,
                        groups: [
                            {
                                child_uuid: 'child-1',
                                child_name: 'web',
                                child_type: 'application',
                                storages: [
                                    {
                                        uuid: 'vol-1',
                                        type: 'persistent',
                                        name: 'child-1-data',
                                        mount_path: '/data',
                                        host_path: null,
                                        is_preview_suffix_enabled: true,
                                        read_only: true,
                                        created_at: null,
                                        updated_at: null,
                                    },
                                ],
                            },
                        ],
                    },
                });
            }

            return jsonResponse({ message: 'not found' }, 404);
        });

        render(<ServiceStoragePanel serviceUuid="svc-1" />);

        await waitFor(() => {
            expect(screen.getByText('Storages')).toBeTruthy();
            expect(screen.getByText('web')).toBeTruthy();
            expect(screen.getByText('/data')).toBeTruthy();
        });
    });
});
