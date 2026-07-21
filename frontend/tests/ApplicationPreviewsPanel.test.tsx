import { cleanup, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApplicationPreviewsPanel } from '../src/components/applications/ApplicationPreviewsPanel';

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

describe('ApplicationPreviewsPanel', () => {
    it('affiche les paramètres et la liste des previews', async () => {
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
            const url = String(input);

            if (url.includes('/previews/settings')) {
                return jsonResponse({
                    data: {
                        is_preview_deployments_enabled: true,
                        preview_url_template: '{{pr_id}}.{{domain}}',
                    },
                });
            }

            if (url.includes('/previews') && !url.includes('/settings')) {
                return jsonResponse({
                    data: [
                        {
                            uuid: 'preview-1',
                            pull_request_id: 42,
                            pull_request_html_url: 'https://github.com/acme/demo/pull/42',
                            fqdn: 'pr-42.example.com',
                            status: 'running:healthy',
                            is_running: true,
                            git_type: 'github',
                            docker_registry_image_tag: null,
                            last_online_at: null,
                            created_at: null,
                            updated_at: null,
                        },
                    ],
                });
            }

            return jsonResponse({ message: 'not found' }, 404);
        });

        render(<ApplicationPreviewsPanel applicationUuid="app-1" canAct />);

        await waitFor(() => {
            expect(screen.getByText('Activer les déploiements preview (PR)')).toBeTruthy();
            expect(screen.getByDisplayValue('{{pr_id}}.{{domain}}')).toBeTruthy();
            expect(screen.getByText('#42')).toBeTruthy();
            expect(screen.getByText('running:healthy')).toBeTruthy();
            expect(screen.getByText('Ouvrir')).toBeTruthy();
        });
    });
});
