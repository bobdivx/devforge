import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServiceImageAutoUpdateToggle } from '../src/components/services/ServiceImageAutoUpdateToggle';

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

describe('ServiceImageAutoUpdateToggle', () => {
    it('persiste le toggle auto-update', async () => {
        const onChanged = vi.fn(async () => {});
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
            const url = String(input);
            if (url.includes('/sanctum/csrf-cookie')) {
                return jsonResponse({});
            }
            if (url.includes('/settings') && init?.method === 'PUT') {
                const body = JSON.parse(String(init.body ?? '{}')) as { is_image_auto_update_enabled?: boolean };
                return jsonResponse({
                    data: {
                        is_image_auto_update_enabled: Boolean(body.is_image_auto_update_enabled),
                        message: 'ok',
                    },
                });
            }

            return jsonResponse({ message: 'not found' }, 404);
        });

        render(
            <ServiceImageAutoUpdateToggle
                serviceUuid="svc-1"
                canAct
                initialEnabled={false}
                onChanged={onChanged}
            />,
        );

        fireEvent.click(screen.getByRole('checkbox'));

        await waitFor(() => {
            expect(fetchMock).toHaveBeenCalled();
            expect(onChanged).toHaveBeenCalled();
            expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
        });
    });
});
