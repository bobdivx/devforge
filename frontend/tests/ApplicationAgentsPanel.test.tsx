import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApplicationAgentsPanel } from '../src/components/applications/ApplicationAgentsPanel';
import type { CoreResource } from '../src/lib/domain-api';

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

vi.mock('../src/lib/team-context', () => ({
    useTeamContext: () => ({ agentsEnabled: true }),
}));

const mockApp: CoreResource = {
    id: 1,
    uuid: 'app-test-uuid',
    name: 'popcorn-tauri',
    type: 'application',
    status: 'running',
    fqdn: 'popcorn.example.com',
    destination: null,
    server: null,
    created_at: '2026-08-24T10:00:00.000Z',
    updated_at: '2026-08-24T10:00:00.000Z',
};

const mockAgents = [
    {
        id: 1,
        uuid: 'agent-worker',
        name: 'Worker',
        type: 'worker',
        avatar_color: '#3b82f6',
        avatar_shape: 'circle',
        description: 'Exécute les missions et corrections',
        is_active: true,
        status: 'idle',
        schedule_minutes: 0,
        parent_agent_id: null,
        resource_uuid: 'app-test-uuid',
        sub_agents_count: 0,
        provider: { id: 1, provider: 'gemini', model: 'gemini-2.5-flash' },
        fallback_provider: null,
        latest_run: null,
        created_at: '2026-08-24T10:00:00.000Z',
    },
    {
        id: 2,
        uuid: 'agent-veille',
        name: 'Veille',
        type: 'tech-watch',
        avatar_color: '#8b5cf6',
        avatar_shape: 'square',
        description: 'Scanne et crée des missions',
        is_active: true,
        status: 'idle',
        schedule_minutes: 240,
        parent_agent_id: null,
        resource_uuid: null,
        sub_agents_count: 0,
        provider: { id: 1, provider: 'gemini', model: 'gemini-2.5-flash' },
        fallback_provider: null,
        latest_run: null,
        created_at: '2026-08-24T10:00:00.000Z',
    },
];

describe('ApplicationAgentsPanel', () => {
    it('affiche les cartes d’agents et permet d’ouvrir le chat', async () => {
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
            const url = String(input);
            const method = String(init?.method ?? 'GET').toUpperCase();

            if (url.includes('/sanctum/csrf-cookie')) {
                return new Response(null, { status: 204 });
            }

            if (url.includes('/agents/agent-worker/sessions')) {
                return jsonResponse({ data: [] });
            }

            if (url.includes('/agents/agent-worker/messages')) {
                return jsonResponse({ data: [] });
            }

            if (url.includes('/agents')) {
                return jsonResponse({ data: mockAgents });
            }

            return jsonResponse({ data: [] });
        });

        render(<ApplicationAgentsPanel application={mockApp} />);

        const workerElements = await screen.findAllByText('Worker');
        expect(workerElements.length).toBeGreaterThanOrEqual(1);
        expect(screen.getByText('Veille')).toBeTruthy();
        expect(screen.getByText('Dédié app')).toBeTruthy();
        expect(screen.getByText(/2 agents/i)).toBeTruthy();
    });

    it('permet de supprimer un agent avec confirmation', async () => {
        const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
        let deleted = false;

        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
            const url = String(input);
            const method = String(init?.method ?? 'GET').toUpperCase();

            if (url.includes('/sanctum/csrf-cookie')) {
                return new Response(null, { status: 204 });
            }

            if (url.includes('/agents/agent-worker') && method === 'DELETE') {
                deleted = true;
                return jsonResponse({ data: { deleted: true } });
            }

            if (url.includes('/agents/agent-worker/sessions')) {
                return jsonResponse({ data: [] });
            }

            if (url.includes('/agents/agent-worker/messages')) {
                return jsonResponse({ data: [] });
            }

            if (url.includes('/agents')) {
                return jsonResponse({ data: deleted ? [mockAgents[1]] : mockAgents });
            }

            return jsonResponse({ data: [] });
        });

        render(<ApplicationAgentsPanel application={mockApp} />);

        const deleteButtons = await screen.findAllByTitle('Supprimer cet agent');
        fireEvent.click(deleteButtons[0]);

        expect(confirmSpy).toHaveBeenCalled();
        await waitFor(() => {
            expect(deleted).toBe(true);
        });
    });

    it('permet de réinitialiser l’équipe avec confirmation', async () => {
        const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
        let resetCalled = false;

        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
            const url = String(input);
            const method = String(init?.method ?? 'GET').toUpperCase();

            if (url.includes('/sanctum/csrf-cookie')) {
                return new Response(null, { status: 204 });
            }

            if (url.includes('/agents/reset') && method === 'POST') {
                resetCalled = true;
                return jsonResponse({ ok: true, data: mockAgents });
            }

            if (url.includes('/agents/agent-worker/sessions')) {
                return jsonResponse({ data: [] });
            }

            if (url.includes('/agents/agent-worker/messages')) {
                return jsonResponse({ data: [] });
            }

            if (url.includes('/agents')) {
                return jsonResponse({ data: mockAgents });
            }

            return jsonResponse({ data: [] });
        });

        render(<ApplicationAgentsPanel application={mockApp} />);

        const resetButton = await screen.findByTitle(/Nettoie et recrée l'équipe propre par défaut/i);
        fireEvent.click(resetButton);

        expect(confirmSpy).toHaveBeenCalled();
        await waitFor(() => {
            expect(resetCalled).toBe(true);
        });
    });
});
