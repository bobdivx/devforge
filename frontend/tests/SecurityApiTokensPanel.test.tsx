import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
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
    it('affiche les jetons API et l’encart MCP', async () => {
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
            expect(screen.getAllByText('read').length).toBeGreaterThan(0);
            expect(screen.getByText('MCP DevForge (Cursor)')).toBeTruthy();
            expect(screen.getAllByText(/mcp\/devforge/).length).toBeGreaterThan(0);
            expect(screen.queryByText(/Coolify/i)).toBeNull();
        });
    });

    it('préremplit un jeton MCP avec read+write', async () => {
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
            const url = String(input);
            if (url.includes('/security/api-tokens')) {
                return jsonResponse({
                    data: [],
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
            expect(screen.getByRole('button', { name: 'Créer un jeton pour MCP' })).toBeTruthy();
        });

        fireEvent.click(screen.getByRole('button', { name: 'Créer un jeton pour MCP' }));

        await waitFor(() => {
            expect((screen.getByPlaceholderText('Cursor MCP') as HTMLInputElement).value).toBe('Cursor MCP');
            const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
            const checked = checkboxes.filter((box) => box.checked).map((box) => box.parentElement?.textContent ?? '');
            expect(checked.some((text) => text.includes('read') && !text.includes('sensitive'))).toBe(true);
            expect(checked.some((text) => text.includes('write') && !text.includes('sensitive'))).toBe(true);
        });
    });
});
