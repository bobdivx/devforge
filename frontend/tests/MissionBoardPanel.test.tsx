import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MissionBoardPanel } from '../src/components/agents/MissionBoardPanel';

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

describe('MissionBoardPanel', () => {
    it('termine les missions en cours via le bouton bulk', async () => {
        const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
        let inProgress = true;

        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
            const url = String(input);
            const method = String(init?.method ?? 'GET').toUpperCase();

            if (url.includes('/sanctum/csrf-cookie')) {
                return new Response(null, { status: 204 });
            }

            if (url.includes('/ai/missions/bulk-status') && method === 'POST') {
                inProgress = false;
                return jsonResponse({
                    ok: true,
                    meta: { updated: 2, from_status: 'in_progress', to_status: 'done' },
                });
            }

            if (url.includes('/ai/missions')) {
                return jsonResponse({
                    data: inProgress
                        ? [
                            {
                                uuid: 'm-1',
                                kind: 'bug',
                                status: 'in_progress',
                                priority: 'high',
                                title: 'Disk full',
                                description: null,
                                source: 'tech_watch',
                                resource_uuid: null,
                                assignee_name: 'Build',
                                assignee_type: 'deployment',
                                blocked_reason: null,
                                timeline: [],
                                metadata: {},
                                is_feature_delivery: false,
                                created_at: '2026-08-11T10:00:00.000Z',
                                updated_at: '2026-08-11T10:00:00.000Z',
                                completed_at: null,
                            },
                            {
                                uuid: 'm-2',
                                kind: 'ops',
                                status: 'in_progress',
                                priority: 'urgent',
                                title: 'DB exited',
                                description: null,
                                source: 'tech_watch',
                                resource_uuid: null,
                                assignee_name: 'Build',
                                assignee_type: 'deployment',
                                blocked_reason: null,
                                timeline: [],
                                metadata: {},
                                is_feature_delivery: false,
                                created_at: '2026-08-11T10:00:00.000Z',
                                updated_at: '2026-08-11T10:00:00.000Z',
                                completed_at: null,
                            },
                        ]
                        : [],
                    meta: { count: inProgress ? 2 : 0, available: true },
                });
            }

            return jsonResponse({ data: [] });
        });

        render(<MissionBoardPanel />);

        const bulkButton = await screen.findByRole('button', { name: /Terminer les en cours \(2\)/i });
        fireEvent.click(bulkButton);

        await waitFor(() => {
            expect(confirmSpy).toHaveBeenCalled();
        });

        await waitFor(() => {
            expect(screen.queryByRole('button', { name: /Terminer les en cours/i })).toBeNull();
        });
    });
});
