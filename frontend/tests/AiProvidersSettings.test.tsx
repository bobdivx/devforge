import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiProvidersSettings } from '../src/components/agents/AiProvidersSettings';
import { TeamContext } from '../src/lib/team-context';
import type { AiProviderConfig } from '../src/lib/domain-api';

function jsonResponse(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}

const providersFixture: AiProviderConfig[] = [{
    id: 7,
    provider: 'gemini',
    name: 'Gemini Flash',
    model: 'gemini-2.5-flash',
    base_url: null,
    has_api_key: true,
    is_default: true,
    created_at: '2026-01-01T00:00:00.000Z',
}];

function renderWithAgentsEnabled() {
    return render(
        <TeamContext.Provider value={{ teamId: 1, revision: 0, agentsEnabled: true }}>
            <AiProvidersSettings />
        </TeamContext.Provider>,
    );
}

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('AiProvidersSettings', () => {
    it('ouvre le formulaire d’édition et enregistre les modifications', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
            const url = String(input);
            const method = init?.method ?? 'GET';

            if (url === '/sanctum/csrf-cookie') {
                return new Response(null, { status: 204 });
            }

            if (url === '/api/devforge/v1/ai/providers' && method === 'GET') {
                return jsonResponse({ data: providersFixture });
            }

            if (url === '/api/devforge/v1/ai/providers/models' && method === 'POST') {
                return jsonResponse({
                    data: {
                        models: [{ id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' }],
                    },
                });
            }

            if (url === '/api/devforge/v1/ai/providers/7' && method === 'PUT') {
                return jsonResponse({
                    data: {
                        ...providersFixture[0],
                        name: 'Gemini Pro Équipe',
                    },
                });
            }

            throw new Error(`Requête inattendue : ${method} ${url}`);
        });

        renderWithAgentsEnabled();

        expect(await screen.findByText('Gemini Flash')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Modèles locaux' })).toHaveAttribute('href', '#models');
        expect(screen.getByRole('link', { name: 'section dédiée' })).toHaveAttribute('href', '#pinokio');

        fireEvent.click(screen.getByTitle('Modifier'));

        expect(await screen.findByText('Modifier le provider')).toBeInTheDocument();

        const nameInput = screen.getByPlaceholderText('ex. Gemini Pro Équipe');
        fireEvent.input(nameInput, { target: { value: 'Gemini Pro Équipe' } });

        fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));

        await waitFor(() => {
            const putCall = fetchMock.mock.calls.find(([url, init]) => (
                String(url) === '/api/devforge/v1/ai/providers/7' && init?.method === 'PUT'
            ));
            expect(putCall).toBeDefined();
        });

        const putCall = fetchMock.mock.calls.find(([url, init]) => (
            String(url) === '/api/devforge/v1/ai/providers/7' && init?.method === 'PUT'
        ));
        expect(putCall).toBeDefined();
        expect(JSON.parse(String(putCall?.[1]?.body))).toMatchObject({
            name: 'Gemini Pro Équipe',
            model: 'gemini-2.5-flash',
            is_default: true,
        });
    });

    it('permet de configurer un provider Local AI Studio / OpenAI local sans forcer la clé API', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
            const url = String(input);
            const method = init?.method ?? 'GET';

            if (url === '/sanctum/csrf-cookie') {
                return new Response(null, { status: 204 });
            }

            if (url === '/api/devforge/v1/ai/providers' && method === 'GET') {
                return jsonResponse({ data: [] });
            }

            if (url === '/api/devforge/v1/ai/providers/models' && method === 'POST') {
                return jsonResponse({
                    data: {
                        models: [{ id: 'qwen3', label: 'Qwen 3 (Local)' }],
                    },
                });
            }

            if (url === '/api/devforge/v1/ai/providers' && method === 'POST') {
                return jsonResponse({
                    data: {
                        id: 42,
                        provider: 'openai',
                        name: 'Local AI Studio',
                        model: 'qwen3',
                        base_url: 'http://10.1.0.88:10086/v1',
                        has_api_key: false,
                        is_default: true,
                        created_at: '2026-01-01T00:00:00.000Z',
                    },
                }, 201);
            }

            throw new Error(`Requête inattendue : ${method} ${url}`);
        });

        renderWithAgentsEnabled();

        fireEvent.click(screen.getByRole('button', { name: 'Ajouter' }));

        expect(await screen.findByText('Nouveau provider')).toBeInTheDocument();

        const providerSelect = screen.getAllByRole('combobox')[0];
        fireEvent.change(providerSelect, { target: { value: 'openai' } });

        const nameInput = screen.getByPlaceholderText('ex. Gemini Pro Équipe');
        fireEvent.input(nameInput, { target: { value: 'Local AI Studio' } });

        const urlInput = screen.getByPlaceholderText('https://api.openai.com/v1');
        fireEvent.input(urlInput, { target: { value: 'http://10.1.0.88:10086/v1' } });

        await waitFor(() => {
            expect(fetchMock.mock.calls.some(([url]) => String(url) === '/api/devforge/v1/ai/providers/models')).toBe(true);
        });
    });
});
