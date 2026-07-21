import { cleanup, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApplicationResourceLimitsPanel } from '../src/components/applications/ApplicationResourceLimitsPanel';

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

describe('ApplicationResourceLimitsPanel', () => {
    it('affiche les limites de ressources', async () => {
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
            const url = String(input);
            if (url.includes('/resource-limits')) {
                return jsonResponse({
                    data: {
                        limits_cpus: '1',
                        limits_cpuset: null,
                        limits_cpu_shares: 1024,
                        limits_memory: '512m',
                        limits_memory_swap: '0',
                        limits_memory_reservation: '0',
                        limits_memory_swappiness: 60,
                    },
                });
            }

            return jsonResponse({ message: 'not found' }, 404);
        });

        render(<ApplicationResourceLimitsPanel applicationUuid="app-1" canAct />);

        await waitFor(() => {
            expect(screen.getByText('Limites de ressources')).toBeTruthy();
            expect(screen.getByDisplayValue('512m')).toBeTruthy();
            expect(screen.getByDisplayValue('1024')).toBeTruthy();
        });
    });
});
