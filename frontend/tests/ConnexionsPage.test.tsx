import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnexionsPage } from '../src/pages/sources/_SourcesPage';

function jsonResponse(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}

function mockApis(options?: {
    apps?: unknown[];
    requests?: unknown[];
    teamVariables?: unknown[];
    tokens?: unknown[];
}) {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
        const url = String(input);
        if (url === '/api/devforge/v1/github/apps') {
            return jsonResponse({ data: options?.apps ?? [] });
        }
        if (url === '/api/devforge/v1/agent-key-requests') {
            return jsonResponse({ data: options?.requests ?? [] });
        }
        if (url === '/api/devforge/v1/shared-variables') {
            return jsonResponse({
                data: {
                    team: options?.teamVariables ?? [],
                    project: [],
                    environment: [],
                    server: [],
                },
            });
        }
        if (url === '/api/devforge/v1/security/api-tokens') {
            return jsonResponse({
                data: options?.tokens ?? [],
                meta: { is_api_enabled: true, can_use_root: true, can_use_write: true },
            });
        }
        throw new Error(`URL inattendue : ${url}`);
    });
}

afterEach(() => {
    cleanup();
});

describe('ConnexionsPage', () => {
    it('affiche un catalogue Store sans HEALTH_GATEWAY ni Slack/Vercel', async () => {
        mockApis({
            requests: [
                { uuid: 'req-db', key_name: 'ASTRO_DB_REMOTE_URL', status: 'pending', agent: { name: 'Jean' }, reason: 'Besoin de Turso' },
                { uuid: 'req-health', key_name: 'HEALTH_GATEWAY', status: 'pending' },
                { uuid: 'req-local', key_name: 'LOCALHOST_SERVER_UUID', status: 'pending' },
            ],
        });

        render(<ConnexionsPage />);

        expect(await screen.findByRole('heading', { name: 'Connexions' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'GitHub' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Turso / bases' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Clés d’équipe' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'MCP DevForge' })).toBeInTheDocument();
        expect(screen.getAllByText('Demande agent').length).toBeGreaterThan(0);
        expect(screen.queryByText('HEALTH_GATEWAY')).not.toBeInTheDocument();
        expect(screen.queryByText('Slack')).not.toBeInTheDocument();
        expect(screen.queryByText('Vercel')).not.toBeInTheDocument();
        expect(screen.queryByText('Pocket ID')).not.toBeInTheDocument();
    });

    it('ouvre le modal Turso avec la demande agent regroupée', async () => {
        mockApis({
            requests: [
                { uuid: 'req-db', key_name: 'DATABASE_URL_MACOMPTA', status: 'pending', agent: { name: 'Jean' }, reason: 'URL Turso' },
            ],
        });

        render(<ConnexionsPage />);

        const card = await screen.findByRole('button', { name: /Turso \/ bases/i });
        fireEvent.click(card);

        expect(await screen.findByText('Jean')).toBeInTheDocument();
        expect(screen.getByText('DATABASE_URL_MACOMPTA')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('Valeur pour DATABASE_URL_MACOMPTA')).toBeInTheDocument();
    });

    it('ouvre le modal GitHub pour coller un PAT', async () => {
        mockApis({
            apps: [{
                uuid: 'gh-1',
                name: 'DevForge',
                account_login: 'bobdivx',
                installation_id: '42',
                has_packages_token: false,
                organization: null,
                html_url: 'https://github.com/apps/devforge',
            }],
        });

        render(<ConnexionsPage />);

        const card = await screen.findByRole('button', { name: /GitHub/i });
        fireEvent.click(card);

        expect(await screen.findByPlaceholderText('ghp_… (PAT read:packages)')).toBeInTheDocument();
        expect(screen.getByText('@bobdivx')).toBeInTheDocument();
    });
});
