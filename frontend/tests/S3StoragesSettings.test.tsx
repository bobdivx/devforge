import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { S3StoragesSettings } from '../src/components/storages/S3StoragesSettings';
import type { S3Storage } from '../src/lib/domain-api';
import { TeamContext } from '../src/lib/team-context';

function jsonResponse(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}

const storageFixture: S3Storage = {
    uuid: 'my2gtulfu369jfgyygmz6gvu',
    name: 'Backups Scaleway',
    description: null,
    region: 'fr-par',
    bucket: 'devforge',
    endpoint: 'https://s3.fr-par.scw.cloud',
    is_usable: false,
    scheduled_backups_count: 0,
    created_at: '2026-08-17T00:00:00.000Z',
    updated_at: '2026-08-17T00:00:00.000Z',
};

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('S3StoragesSettings', () => {
    it('poste le test de connexion vers le CUID de la destination', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
            const url = String(input);
            const method = init?.method ?? 'GET';

            if (url === '/sanctum/csrf-cookie') {
                return new Response(null, { status: 204 });
            }

            if (url === '/api/devforge/v1/s3-storages' && method === 'GET') {
                return jsonResponse({ data: [storageFixture] });
            }

            if (url === `/api/devforge/v1/s3-storages/${storageFixture.uuid}/test` && method === 'POST') {
                return jsonResponse({
                    data: {
                        success: true,
                        message: 'Connexion S3 validée.',
                        storage: { ...storageFixture, is_usable: true },
                    },
                });
            }

            throw new Error(`Requête inattendue : ${method} ${url}`);
        });

        render(
            <TeamContext.Provider value={{ teamId: 1, revision: 0, agentsEnabled: false }}>
                <S3StoragesSettings />
            </TeamContext.Provider>,
        );

        expect(await screen.findByText('Backups Scaleway')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /Tester/ }));

        await waitFor(() => {
            expect(screen.getByText('Connexion S3 validée.')).toBeInTheDocument();
        });

        expect(fetchMock.mock.calls.some(([url, init]) => (
            String(url) === `/api/devforge/v1/s3-storages/${storageFixture.uuid}/test`
            && init?.method === 'POST'
        ))).toBe(true);
    });
});
