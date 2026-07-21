import { cleanup, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApplicationWebhooksPanel } from '../src/components/applications/ApplicationWebhooksPanel';

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

describe('ApplicationWebhooksPanel', () => {
    it('affiche le deploy webhook et les URLs manuelles', async () => {
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
            const url = String(input);
            if (url.includes('/webhooks')) {
                return jsonResponse({
                    data: {
                        deploy_webhook_url: 'https://example.test/api/v1/deploy?uuid=app-1&force=false',
                        manual_webhooks_available: true,
                        uses_git_app: false,
                        manual: {
                            github: {
                                url: 'https://example.test/webhooks/source/github/events/manual',
                                secret_set: true,
                                configuration_url: 'https://github.com/acme/demo/settings/hooks',
                            },
                            gitlab: { url: 'https://example.test/webhooks/source/gitlab/events/manual', secret_set: false },
                            bitbucket: { url: 'https://example.test/webhooks/source/bitbucket/events/manual', secret_set: false },
                            gitea: { url: 'https://example.test/webhooks/source/gitea/events/manual', secret_set: false },
                        },
                    },
                });
            }

            return jsonResponse({ message: 'not found' }, 404);
        });

        render(<ApplicationWebhooksPanel applicationUuid="app-1" canAct />);

        await waitFor(() => {
            expect(screen.getByDisplayValue('https://example.test/api/v1/deploy?uuid=app-1&force=false')).toBeTruthy();
            expect(screen.getByText('Webhooks Git manuels')).toBeTruthy();
            expect(screen.getByText('Déjà configuré')).toBeTruthy();
        });
    });
});
