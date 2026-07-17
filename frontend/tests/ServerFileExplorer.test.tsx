import { cleanup, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServerFileExplorer } from '../src/components/servers/ServerFileExplorer';

function jsonResponse(data: unknown): Response {
    return new Response(JSON.stringify(data), {
        status: 200,
        headers: { 'content-type': 'application/json' },
    });
}

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('ServerFileExplorer', () => {
    it('affiche un message quand le terminal est désactivé', () => {
        render(<ServerFileExplorer serverUuid="server-1" terminalEnabled={false} />);

        expect(screen.getByText(/terminal ssh est désactivé/i)).toBeTruthy();
    });

    it('charge le répertoire par défaut au montage', async () => {
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
            const url = String(input);

            if (url.includes('/server-files/server-1/list')) {
                return jsonResponse({
                    data: {
                        path: '/data/coolify',
                        parent_path: '/data',
                        entry_count: 1,
                        entries: [{
                            name: 'applications',
                            type: 'directory',
                            size: 4096,
                            permissions: 'drwxr-xr-x',
                            modified_label: 'Jan 1 10:00',
                            symlink_target: null,
                        }],
                    },
                    meta: {
                        default_path: '/data/coolify',
                        read_max_bytes: 65536,
                        write_max_bytes: 32768,
                    },
                });
            }

            throw new Error(`URL inattendue : ${url}`);
        });

        render(<ServerFileExplorer serverUuid="server-1" />);

        expect(await screen.findByText('applications')).toBeTruthy();
    });
});
