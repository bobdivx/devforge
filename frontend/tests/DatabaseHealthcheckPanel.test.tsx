import { cleanup, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseHealthcheckPanel } from '../src/components/databases/DatabaseHealthcheckPanel';

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

describe('DatabaseHealthcheckPanel', () => {
    it('affiche les paramètres healthcheck', async () => {
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
            const url = String(input);
            if (url.includes('/healthcheck')) {
                return jsonResponse({
                    data: {
                        health_check_enabled: true,
                        health_check_interval: 15,
                        health_check_timeout: 5,
                        health_check_retries: 5,
                        health_check_start_period: 5,
                        probe_label: 'psql — SELECT 1',
                        restart_required: false,
                    },
                });
            }

            return jsonResponse({ message: 'not found' }, 404);
        });

        render(<DatabaseHealthcheckPanel databaseUuid="db-1" canAct />);

        await waitFor(() => {
            expect(screen.getByText('Activer le healthcheck')).toBeTruthy();
            expect(screen.getByText('psql — SELECT 1')).toBeTruthy();
            expect(screen.getByDisplayValue('15')).toBeTruthy();
        });
    });
});
