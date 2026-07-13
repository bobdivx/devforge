import { cleanup, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApplicationLogsPanel } from '../src/components/applications/ApplicationLogsPanel';

function jsonResponse(data: unknown): Response {
    return new Response(JSON.stringify(data), {
        status: 200,
        headers: { 'content-type': 'application/json' },
    });
}

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
});

describe('ApplicationLogsPanel', () => {
    beforeEach(() => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
    });

    it('rafraîchit les logs en silence sans masquer le contenu', async () => {
        let callCount = 0;
        vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
            callCount += 1;

            return jsonResponse({
                data: {
                    available: true,
                    reason: null,
                    message: null,
                    container: 'app-container',
                    container_status: 'running',
                    line_count: 200,
                    items: [{ cursor: 1, message: callCount === 1 ? 'Première ligne' : 'Ligne mise à jour' }],
                },
            });
        });

        render(<ApplicationLogsPanel applicationUuid="app-uuid-1234" />);

        expect(await screen.findByText('Première ligne')).toBeInTheDocument();
        expect(screen.queryByText('Chargement…')).not.toBeInTheDocument();

        await vi.advanceTimersByTimeAsync(2000);

        await waitFor(() => expect(screen.getByText('Ligne mise à jour')).toBeInTheDocument());
        expect(screen.queryByText('Chargement…')).not.toBeInTheDocument();
        expect(callCount).toBeGreaterThanOrEqual(2);
    });
});
