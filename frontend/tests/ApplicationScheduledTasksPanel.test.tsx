import { cleanup, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApplicationScheduledTasksPanel } from '../src/components/applications/ApplicationScheduledTasksPanel';

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

describe('ApplicationScheduledTasksPanel', () => {
    it('affiche les tâches planifiées et l’historique', async () => {
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
            const url = String(input);

            if (url.includes('/scheduled-tasks/') && url.includes('/executions')) {
                return jsonResponse({
                    data: [{
                        uuid: 'exec-1',
                        status: 'success',
                        message: 'ok',
                        started_at: '2026-07-18T08:00:00.000Z',
                        finished_at: '2026-07-18T08:00:01.000Z',
                        duration: 1,
                        retry_count: 0,
                        created_at: '2026-07-18T08:00:00.000Z',
                    }],
                });
            }

            if (url.includes('/scheduled-tasks')) {
                return jsonResponse({
                    data: [{
                        uuid: 'task-1',
                        name: 'Daily cleanup',
                        command: 'php artisan cache:clear',
                        frequency: 'daily',
                        container: null,
                        timeout: 300,
                        enabled: true,
                        latest_execution: {
                            uuid: 'exec-1',
                            status: 'success',
                            message: 'ok',
                            started_at: '2026-07-18T08:00:00.000Z',
                            finished_at: '2026-07-18T08:00:01.000Z',
                            duration: 1,
                            retry_count: 0,
                            created_at: '2026-07-18T08:00:00.000Z',
                        },
                        created_at: '2026-07-18T07:00:00.000Z',
                        updated_at: '2026-07-18T07:00:00.000Z',
                    }],
                });
            }

            return jsonResponse({ message: 'not found' }, 404);
        });

        render(<ApplicationScheduledTasksPanel resourceType="applications" resourceUuid="app-1" canAct />);

        await waitFor(() => {
            expect(screen.getByText('Daily cleanup')).toBeTruthy();
            expect(screen.getByText('Historique')).toBeTruthy();
            expect(screen.getByRole('button', { name: 'Ajouter' })).toBeTruthy();
        });
    });
});
