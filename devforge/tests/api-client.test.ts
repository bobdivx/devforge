import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiFetch, getBootstrap, switchTeam } from '../src/lib/api-client';
import { bootstrapData } from './fixtures';

afterEach(() => {
    document.cookie = 'XSRF-TOKEN=; Max-Age=0; path=/';
});

describe('client API DevForge', () => {
    it('envoie les credentials et le jeton CSRF Laravel', async () => {
        document.cookie = 'XSRF-TOKEN=jeton%20csrf; path=/';
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response(JSON.stringify({ ok: true }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            }),
        );

        await apiFetch<{ ok: boolean }>('/api/example', {
            method: 'POST',
            body: JSON.stringify({ name: 'DevForge' }),
        });

        const [, request] = fetchMock.mock.calls[0];
        const headers = new Headers(request?.headers);
        expect(request?.credentials).toBe('include');
        expect(headers.get('X-XSRF-TOKEN')).toBe('jeton csrf');
        expect(headers.get('Content-Type')).toBe('application/json');
    });

    it('charge le contrat bootstrap réel', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response(JSON.stringify({ data: bootstrapData }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            }),
        );

        const response = await getBootstrap();

        expect(fetchMock).toHaveBeenCalledWith(
            '/api/devforge/v1/bootstrap',
            expect.objectContaining({ credentials: 'include' }),
        );
        expect(response.data.current_team.name).toBe('Équipe Alpha');
        expect(response.data.permissions.manage_team).toBe(true);
    });

    it('initialise le CSRF puis change d’équipe', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch')
            .mockResolvedValueOnce(new Response(null, { status: 204 }))
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ data: bootstrapData }), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                }),
            );

        await switchTeam(20);

        expect(fetchMock.mock.calls[0][0]).toBe('/sanctum/csrf-cookie');
        expect(fetchMock.mock.calls[1][0]).toBe('/api/devforge/v1/teams/switch');
        const switchRequest = fetchMock.mock.calls[1][1];
        expect(switchRequest?.method).toBe('POST');
        expect(switchRequest?.body).toBe(JSON.stringify({ team_id: 20 }));
    });

    it('expose les erreurs API typées', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response(JSON.stringify({ message: 'Interdit' }), {
                status: 403,
                headers: { 'content-type': 'application/json' },
            }),
        );

        await expect(apiFetch('/api/example')).rejects.toEqual(
            expect.objectContaining({ status: 403 }),
        );
    });
});
