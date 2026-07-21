import { cleanup, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SecurityApiTokensPanel } from '../src/components/security/SecurityApiTokensPanel';

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

describe('SecurityApiTokensPanel', () => {
    it('affiche les jetons API sans bannière legacy', async () => {
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
            const url = String(input);
            if (url.includes('/security/api-tokens')) {
                return jsonResponse({
                    data: [
                        {
                            id: 1,
                            name: 'CI token',
                            abilities: ['read'],
                            team_id: 1,
                            last_used_at: null,
                            expires_at: '2026-08-01T00:00:00Z',
                            created_at: '2026-07-01T00:00:00Z',
                            is_expired: false,
                        },
                    ],
                    meta: {
                        is_api_enabled: true,
                        can_use_root: true,
                        can_use_write: true,
                    },
                });
            }

            return jsonResponse({ message: 'not found' }, 404);
        });

        render(<SecurityApiTokensPanel />);

        await waitFor(() => {
            expect(screen.getByText('CI token')).toBeTruthy();
            expect(screen.getByText('read')).toBeTruthy();
            expect(screen.queryByText(/Coolify/i)).toBeNull();
        });
    });
});
