import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OnboardingPage } from '../src/pages/onboarding/_OnboardingPage';
import { bootstrapData } from './fixtures';

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

describe('OnboardingPage', () => {
    it('ouvre GitHub en premier quand l’onboarding est requis', async () => {
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
            const url = String(input);
            if (url.includes('/github/apps') && !url.includes('install-url')) {
                return jsonResponse({ data: [] });
            }
            throw new Error(`URL inattendue : ${url}`);
        });

        render(<OnboardingPage bootstrap={{
            ...bootstrapData,
            onboarding: {
                ...bootstrapData.onboarding,
                required: true,
                steps: { account: true, github: false, s3: false, server: false },
            },
        }}
        />);

        expect(await screen.findByRole('heading', { name: 'Connecter GitHub' })).toBeInTheDocument();
        expect(await screen.findByRole('button', { name: 'Continuer avec GitHub' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Plus tard' })).toBeInTheDocument();
    });

    it('termine l’onboarding depuis l’étape finale', async () => {
        const assign = vi.fn();
        vi.stubGlobal('location', { ...window.location, assign });
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
            const url = String(input);
            if (url === '/sanctum/csrf-cookie') {
                return new Response(null, { status: 204 });
            }
            if (url === '/api/devforge/v1/onboarding/complete') {
                return jsonResponse({ data: bootstrapData, message: 'ok' });
            }
            throw new Error(`URL inattendue : ${url}`);
        });

        render(<OnboardingPage bootstrap={{
            ...bootstrapData,
            onboarding: {
                ...bootstrapData.onboarding,
                required: true,
                steps: { account: true, github: true, s3: true, server: true },
            },
        }}
        />);

        expect(await screen.findByRole('heading', { name: 'Vous êtes prêt' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Entrer dans DevForge' }));
        await waitFor(() => {
            expect(assign).toHaveBeenCalled();
        });
    });
});
