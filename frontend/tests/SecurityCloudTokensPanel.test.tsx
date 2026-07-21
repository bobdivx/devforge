import { cleanup, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SecurityCloudTokensPanel } from '../src/components/security/SecurityCloudTokensPanel';

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

describe('SecurityCloudTokensPanel', () => {
    it('affiche les jetons cloud sans bannière legacy', async () => {
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
            const url = String(input);
            if (url.includes('/security/cloud-tokens')) {
                return jsonResponse({
                    data: [
                        {
                            uuid: 'tok-1',
                            name: 'Hetzner prod',
                            provider: 'hetzner',
                            team_id: 1,
                            servers_count: 2,
                            created_at: '2026-07-01T00:00:00Z',
                            updated_at: '2026-07-01T00:00:00Z',
                        },
                    ],
                });
            }

            return jsonResponse({ message: 'not found' }, 404);
        });

        render(<SecurityCloudTokensPanel />);

        await waitFor(() => {
            expect(screen.getByText('Hetzner prod')).toBeTruthy();
            expect(screen.getByText('Hetzner')).toBeTruthy();
            expect(screen.getByText('2')).toBeTruthy();
            expect(screen.queryByText(/Coolify/i)).toBeNull();
        });
    });
});
