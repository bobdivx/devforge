import { cleanup, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SecurityPrivateKeysPanel } from '../src/components/security/SecurityPrivateKeysPanel';

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

describe('SecurityPrivateKeysPanel', () => {
    it('affiche les clés privées sans bannière legacy', async () => {
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
            const url = String(input);
            if (url.includes('/security/keys')) {
                return jsonResponse({
                    data: [
                        {
                            id: 1,
                            uuid: 'key-1',
                            name: 'Deploy',
                            description: 'Prod',
                            fingerprint: 'SHA256:abc',
                            is_git_related: false,
                            private_key: '********',
                            created_at: '2026-01-01T00:00:00Z',
                        },
                    ],
                });
            }

            return jsonResponse({ message: 'not found' }, 404);
        });

        render(<SecurityPrivateKeysPanel />);

        await waitFor(() => {
            expect(screen.getByText('Deploy')).toBeTruthy();
            expect(screen.getByText('SHA256:abc')).toBeTruthy();
            expect(screen.queryByText(/Coolify/i)).toBeNull();
        });
    });
});
