import { cleanup, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApplicationAgentChatCard } from '../src/components/applications/ApplicationAgentChatCard';
import type { CoreResource } from '../src/lib/domain-api';

function jsonResponse(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}

const application: CoreResource = {
    uuid: 'app-uuid-1234',
    type: 'application',
    name: 'macompta',
    description: null,
    status: 'running',
    configuration: {},
    actions: ['deploy'],
    created_at: '2026-07-01T00:00:00.000Z',
    updated_at: '2026-07-01T00:00:00.000Z',
};

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('ApplicationAgentChatCard', () => {
    it('prépare une session App · et affiche le chat', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
            const url = String(input);
            const method = (init?.method ?? 'GET').toUpperCase();

            if (url.includes('/sanctum/csrf-cookie')) {
                return new Response(null, { status: 204 });
            }

            if (url.includes('/api/devforge/v1/agents') && !url.includes('/sessions') && method === 'GET') {
                return jsonResponse({
                    data: [{
                        uuid: 'agent-1',
                        type: 'deployment',
                        name: 'Deploy Agent',
                        description: null,
                        avatar_color: '#111',
                        system_prompt: null,
                        schedule_minutes: 0,
                        trigger_mode: 'manual',
                        is_active: true,
                        status: 'idle',
                        last_run_at: null,
                        provider: {
                            id: 1,
                            name: 'Gemini',
                            provider: 'gemini',
                            model: 'gemini-2.5-flash',
                        },
                        fallback_provider: null,
                        parent_agent_id: null,
                        resource_uuid: null,
                        sub_agents_count: 0,
                        latest_run: null,
                        created_at: '2026-07-01T00:00:00.000Z',
                    }],
                });
            }

            if (url.endsWith('/sessions') && method === 'GET') {
                return jsonResponse({ data: [], meta: { count: 0, active_session_uuid: null } });
            }

            if (url.endsWith('/sessions') && method === 'POST') {
                return jsonResponse({
                    data: {
                        uuid: 'session-1',
                        title: 'App · macompta',
                        is_legacy: false,
                        last_message_at: null,
                        created_at: '2026-07-01T00:00:00.000Z',
                    },
                }, 201);
            }

            if (url.includes('/sessions/session-1/activate')) {
                return jsonResponse({
                    data: {
                        uuid: 'session-1',
                        title: 'App · macompta',
                        is_legacy: false,
                        last_message_at: null,
                        created_at: '2026-07-01T00:00:00.000Z',
                    },
                    meta: { active_session_uuid: 'session-1' },
                });
            }

            if (url.includes('/sessions/session-1/messages') && method === 'GET') {
                return jsonResponse({
                    data: [{
                        uuid: 'welcome',
                        role: 'assistant',
                        content: 'Bonjour',
                        metadata: { welcome: true },
                        run_uuid: null,
                        session_uuid: 'session-1',
                        created_at: '2026-07-01T00:00:00.000Z',
                    }],
                });
            }

            throw new Error(`URL inattendue : ${method} ${url}`);
        });

        render(<ApplicationAgentChatCard application={application} />);

        expect(await screen.findByText('Assistant IA · macompta')).toBeInTheDocument();
        expect(await screen.findByText('Bonjour')).toBeInTheDocument();
        expect(screen.getByPlaceholderText(/@astrojs\/node/)).toBeInTheDocument();
        expect(screen.getByRole('link', { name: /Ouvrir/ })).toHaveAttribute(
            'href',
            expect.stringContaining('/agents/agent-1'),
        );

        await waitFor(() => {
            expect(fetchMock).toHaveBeenCalled();
        });

        const createCall = fetchMock.mock.calls.find(([input, init]) => (
            String(input).endsWith('/sessions')
            && (init?.method ?? 'GET').toUpperCase() === 'POST'
        ));
        expect(createCall).toBeTruthy();
        expect(JSON.parse(String(createCall?.[1]?.body))).toEqual({ title: 'App · macompta' });
    });
});
