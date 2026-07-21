import { cleanup, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseWebhooksPanel } from '../src/components/databases/DatabaseWebhooksPanel';

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

describe('DatabaseWebhooksPanel', () => {
    it('affiche l’URL du deploy webhook', async () => {
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
            const url = String(input);
            if (url.includes('/webhooks')) {
                return jsonResponse({
                    data: {
                        deploy_webhook_url: 'https://example.test/api/v1/deploy?uuid=db-1&force=false',
                    },
                });
            }

            return jsonResponse({ message: 'not found' }, 404);
        });

        render(<DatabaseWebhooksPanel databaseUuid="db-1" />);

        await waitFor(() => {
            expect(screen.getByDisplayValue('https://example.test/api/v1/deploy?uuid=db-1&force=false')).toBeTruthy();
        });
    });
});
