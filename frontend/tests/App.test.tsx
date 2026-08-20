import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/components/App';
import { bootstrapData, overviewFixture } from './fixtures';

function jsonResponse(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}

function installApiMock() {
    return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
        const url = String(input);
        if (url === '/api/devforge/v1/bootstrap') return jsonResponse({ data: bootstrapData });
        if (url === '/api/devforge/v1/overview') {
            return jsonResponse({ data: overviewFixture });
        }
        if (url === '/api/devforge/v1/core/servers') {
            return jsonResponse({
                data: [{
                    uuid: 'server-uuid-1234',
                    type: 'server',
                    name: 'Serveur principal',
                    description: null,
                    status: { reachable: true, usable: true, validating: false },
                    configuration: {},
                    actions: [],
                    created_at: null,
                    updated_at: null,
                }],
                meta: { count: 1 },
            });
        }
        if (url === '/api/devforge/v1/core/applications') return jsonResponse({ data: [], meta: { count: 0 } });
        if (url === '/api/devforge/v1/core/applications/boot-sequence') {
            return jsonResponse({
                data: {
                    active: false,
                    status: 'idle',
                    started_at: null,
                    finished_at: null,
                    current_uuid: null,
                    completed: 0,
                    total: 0,
                    poll_interval_ms: 2500,
                    items: [],
                },
            });
        }
        if (url.includes('/api/devforge/v1/applications/') || url.includes('/api/devforge/v1/core/applications/')) {
            return jsonResponse({ data: null, message: 'Not found' }, 404);
        }
        throw new Error(`URL inattendue : ${url}`);
    });
}

afterEach(() => {
    cleanup();
    window.localStorage.clear();
    window.history.replaceState({}, '', '/');
});

describe('shell DevForge', () => {
    it('charge les serveurs depuis les paramètres', async () => {
        window.history.replaceState({}, '', '/devforge/settings/servers');
        installApiMock();
        render(<App initialPath="/settings/servers" />);

        expect(await screen.findByText('Serveur principal')).toBeInTheDocument();
        expect(window.location.pathname).toBe('/devforge/settings/servers');
        expect(screen.getByRole('link', { name: 'Serveurs' })).toHaveAttribute('aria-current', 'page');
        expect(screen.getByRole('link', { name: 'Paramètres' })).not.toHaveAttribute('aria-current');
        expect(screen.getByRole('combobox', { name: 'Section' })).toHaveValue('servers');
        expect(screen.getByRole('button', { name: 'Serveurs' })).toHaveAttribute('aria-current', 'page');
        expect(screen.queryByRole('link', { name: 'Coolify' })).not.toBeInTheDocument();
        expect(screen.getAllByText('DevForge').length).toBeGreaterThan(0);
    });

    it('change réellement d’équipe depuis les paramètres', async () => {
        window.history.replaceState({}, '', '/devforge/settings/team');
        const betaData = {
            ...bootstrapData,
            current_team: { ...bootstrapData.teams[1], is_current: true },
        };
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
            const url = String(input);
            if (url === '/api/devforge/v1/bootstrap') return jsonResponse({ data: bootstrapData });
            if (url === '/api/devforge/v1/teams/current') {
                return jsonResponse({ data: bootstrapData.current_team });
            }
            if (url === '/api/devforge/v1/teams/current/members') return jsonResponse({ data: [] });
            if (url === '/sanctum/csrf-cookie') return new Response(null, { status: 204 });
            if (url === '/api/devforge/v1/teams/switch') return jsonResponse({ data: betaData });
            throw new Error(`URL inattendue : ${url}`);
        });
        render(<App initialPath="/settings/team" />);

        const teamSelect = await screen.findByRole('combobox', { name: 'Équipe active' });
        fireEvent.change(teamSelect, { target: { value: '20' } });

        await waitFor(() => expect(screen.getByRole('combobox', { name: 'Équipe active' })).toHaveValue('20'));
        expect(fetchMock.mock.calls.map(([input]) => input)).toContain('/api/devforge/v1/teams/switch');
    });

    it('affiche l’état invité et le lien de connexion sur 401', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            jsonResponse({ message: 'Unauthenticated.' }, 401),
        );
        render(<App initialPath="/" />);

        expect(await screen.findByRole('heading', { name: 'Session requise' })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Se connecter' })).toHaveAttribute('href', '/login?redirect=/devforge/');
    });

    it('applique le thème sombre', async () => {
        window.localStorage.setItem('devforge-theme', 'light');
        installApiMock();
        render(<App initialPath="/" />);

        fireEvent.click(await screen.findByRole('button', { name: 'Activer le thème sombre' }));
        expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    });
});
