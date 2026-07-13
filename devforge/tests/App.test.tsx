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
        expect(screen.getByRole('link', { name: 'Paramètres' })).toHaveAttribute('aria-current', 'page');
        expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('Serveurs');
        expect(screen.getByRole('link', { name: 'Coolify' })).toHaveAttribute('href', 'https://coolify.io');
        expect(screen.queryByRole('link', { name: 'Retour Coolify' })).not.toBeInTheDocument();
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
            if (url === '/api/devforge/v1/members') return jsonResponse({ data: [] });
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

    it('résout une route dynamique sans la rabattre sur le dashboard', async () => {
        window.history.replaceState({}, '', '/devforge/project/project-1/environment/environment-1/application/app-1/logs');
        installApiMock();
        render(<App initialPath="/" />);

        expect(await screen.findByRole('heading', { name: 'Applications' })).toBeInTheDocument();
        expect(await screen.findByText('Aucune ressource « applications ».')).toBeInTheDocument();
    });

    it('affiche l’état invité et le lien de connexion sur 401', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            jsonResponse({ message: 'Unauthenticated.' }, 401),
        );
        render(<App initialPath="/" />);

        expect(await screen.findByRole('heading', { name: 'Session requise' })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Se connecter' })).toHaveAttribute('href', '/login');
    });

    it('applique le thème sombre', async () => {
        window.localStorage.setItem('devforge-theme', 'light');
        installApiMock();
        render(<App initialPath="/" />);

        fireEvent.click(await screen.findByRole('button', { name: 'Activer le thème sombre' }));
        expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    });
});
