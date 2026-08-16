import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RestartOnboardingButton } from '../src/components/onboarding/RestartOnboardingButton';

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

describe('RestartOnboardingButton', () => {
    it('relance l’assistant puis ouvre le wizard', async () => {
        const assign = vi.fn();
        vi.stubGlobal('location', { ...window.location, assign });
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
            const url = String(input);
            if (url === '/sanctum/csrf-cookie') {
                return new Response(null, { status: 204 });
            }
            if (url === '/api/devforge/v1/onboarding/restart') {
                return jsonResponse({ data: {}, message: 'ok' });
            }
            throw new Error(`URL inattendue : ${url}`);
        });

        render(<RestartOnboardingButton />);
        fireEvent.click(screen.getByRole('button', { name: 'Relancer l’assistant' }));

        await waitFor(() => {
            expect(assign).toHaveBeenCalled();
        });
    });
});
