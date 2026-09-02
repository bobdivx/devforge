import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PinokioStudioManager } from '../src/components/agents/PinokioStudioManager';
import { TeamContext } from '../src/lib/team-context';

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

describe('PinokioStudioManager', () => {
    it('affiche les champs studio et LLM et permet d’enregistrer Demeter', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
            const url = String(input);
            const method = init?.method ?? 'GET';

            if (url === '/sanctum/csrf-cookie') {
                return new Response(null, { status: 204 });
            }

            if (url === '/api/devforge/v1/ai/pinokio/instances') {
                return jsonResponse({ data: [] });
            }

            if (url.startsWith('/api/devforge/v1/ai/pinokio?')) {
                return jsonResponse({
                    data: {
                        reachable: false,
                        base_url: 'http://10.1.0.88:42000',
                        studio_url: 'http://10.1.0.88:42000',
                        llm_url: 'http://10.1.0.88:10086/v1',
                        active_model: null,
                        running: false,
                        context_size: null,
                        backend_mode: null,
                        gpu: null,
                        models: [],
                        error: 'Impossible de joindre Pinokio',
                    },
                });
            }

            if (url === '/api/devforge/v1/ai/providers' && method === 'POST') {
                return jsonResponse({
                    data: {
                        id: 55,
                        provider: 'openai',
                        name: 'Demeter',
                        model: 'auto',
                        base_url: 'http://10.1.0.88:10086/v1',
                        studio_base_url: 'http://10.1.0.88:42000',
                        has_api_key: false,
                        is_default: false,
                        created_at: '2026-01-01T00:00:00.000Z',
                    },
                }, 201);
            }

            throw new Error(`Requête inattendue : ${method} ${url}`);
        });

        render(
            <TeamContext.Provider value={{ teamId: 1, revision: 0, agentsEnabled: true }}>
                <PinokioStudioManager canManage />
            </TeamContext.Provider>,
        );

        expect(await screen.findByText('Local AI Studio (Pinokio)')).toBeInTheDocument();
        expect(await screen.findByPlaceholderText('10.1.0.88')).toHaveValue('10.1.0.88');
        expect(screen.getByText(/Studio : http:\/\/10\.1\.0\.88:42000/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Enregistrer comme provider/i })).toBeInTheDocument();
        expect(screen.getByText(/Hors ligne/i)).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /Enregistrer comme provider/i }));

        await waitFor(() => {
            expect(fetchMock.mock.calls.some(([req, init]) => {
                if (String(req) !== '/api/devforge/v1/ai/providers' || init?.method !== 'POST') {
                    return false;
                }
                const body = JSON.parse(String(init.body));
                return body.base_url === 'http://10.1.0.88:10086/v1'
                    && body.studio_base_url === 'http://10.1.0.88:42000';
            })).toBe(true);
        });
    });

    it('affiche Demeter en ligne avec modèles quand l’instance répond', async () => {
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
            const url = String(input);

            if (url === '/api/devforge/v1/ai/pinokio/instances') {
                return jsonResponse({
                    data: [{
                        id: 12,
                        name: 'Demeter (RTX 3090)',
                        base_url: 'http://10.1.0.88:10086/v1',
                        studio_base_url: 'http://10.1.0.88:42000',
                        resolved_base_url: 'http://10.1.0.88:42000',
                        llm_base_url: 'http://10.1.0.88:10086',
                        is_default: true,
                        model: 'qwen3',
                        reachable: true,
                    }],
                });
            }

            if (url.startsWith('/api/devforge/v1/ai/pinokio?')) {
                return jsonResponse({
                    data: {
                        reachable: true,
                        base_url: 'http://10.1.0.88:42000',
                        studio_url: 'http://10.1.0.88:42000',
                        llm_url: 'http://10.1.0.88:10086',
                        active_model: 'qwen3',
                        running: true,
                        context_size: 49152,
                        backend_mode: 'CUDA GPU',
                        gpu: { name: 'NVIDIA GeForce RTX 3090', vram_used_gb: 20, vram_total_gb: 24 },
                        models: [{
                            filename: 'qwen3',
                            name: 'qwen3',
                            size: '',
                            size_bytes: 0,
                            is_active: true,
                        }],
                        error: null,
                    },
                });
            }

            throw new Error(`Requête inattendue : ${url}`);
        });

        render(
            <TeamContext.Provider value={{ teamId: 1, revision: 0, agentsEnabled: true }}>
                <PinokioStudioManager canManage />
            </TeamContext.Provider>,
        );

        expect(await screen.findByRole('button', { name: /Demeter \(RTX 3090\)/ })).toBeInTheDocument();
        await waitFor(() => {
            expect(screen.getByText('En ligne')).toBeInTheDocument();
            expect(screen.getByText('Actif en VRAM')).toBeInTheDocument();
            expect(screen.getByText(/49 152 tokens/)).toBeInTheDocument();
        });
    });
});
