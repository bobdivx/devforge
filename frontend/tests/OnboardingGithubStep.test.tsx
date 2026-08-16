import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OnboardingGithubStep } from '../src/components/onboarding/OnboardingGithubStep';

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

describe('OnboardingGithubStep', () => {
    it('propose un seul bouton pour se connecter à GitHub', async () => {
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
            if (String(input).includes('/github/apps')) {
                return jsonResponse({ data: [] });
            }
            throw new Error(`URL inattendue : ${input}`);
        });

        render(<OnboardingGithubStep canManage onSkip={() => undefined} onConnected={() => undefined} />);

        expect(await screen.findByRole('button', { name: 'Continuer avec GitHub' })).toBeInTheDocument();
        expect(screen.queryByLabelText('Nom de l’app')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Plus tard' })).toBeInTheDocument();
    });

    it('demande de choisir les dépôts une fois GitHub installé', async () => {
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
            const url = String(input);
            if (url.endsWith('/github/apps')) {
                return jsonResponse({
                    data: [{
                        uuid: 'app-1',
                        name: 'DevForge',
                        organization: null,
                        html_url: 'https://github.com',
                        is_system_wide: false,
                        installation_id: 99,
                    }],
                });
            }
            if (url.includes('/repositories') && !url.includes('/branches')) {
                return jsonResponse({
                    data: [{
                        id: 7,
                        name: 'popcorn',
                        full_name: 'bob/popcorn',
                        owner: 'bob',
                        private: true,
                        html_url: 'https://github.com/bob/popcorn',
                        default_branch: 'main',
                        description: 'Client',
                    }],
                });
            }
            if (url.endsWith('/projects')) {
                return jsonResponse({
                    data: [{
                        uuid: 'proj-1',
                        name: 'App',
                        environments: [{ uuid: 'env-1', name: 'production' }],
                    }],
                });
            }
            if (url.endsWith('/deployment-targets')) {
                return jsonResponse({
                    data: [{
                        uuid: 'srv-1',
                        name: 'localhost',
                        destinations: [{ uuid: 'dest-1', name: 'docker', type: 'standalone' }],
                    }],
                });
            }
            throw new Error(`URL inattendue : ${url}`);
        });

        render(<OnboardingGithubStep canManage onSkip={() => undefined} onConnected={() => undefined} />);

        expect(await screen.findByRole('heading', { name: 'Quels dépôts démarrer ?' })).toBeInTheDocument();
        expect(await screen.findByText('bob/popcorn')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('checkbox'));
        expect(screen.getByRole('button', { name: 'Démarrer 1 dépôt' })).toBeEnabled();
    });

    it('crée et démarre les dépôts cochés', async () => {
        const onConnected = vi.fn();
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
            const url = String(input);
            if (url === '/sanctum/csrf-cookie') {
                return new Response(null, { status: 204 });
            }
            if (url.endsWith('/github/apps')) {
                return jsonResponse({
                    data: [{
                        uuid: 'app-1',
                        name: 'DevForge',
                        organization: null,
                        html_url: 'https://github.com',
                        is_system_wide: false,
                        installation_id: 99,
                    }],
                });
            }
            if (url.includes('/repositories')) {
                return jsonResponse({
                    data: [{
                        id: 7,
                        name: 'popcorn',
                        full_name: 'bob/popcorn',
                        owner: 'bob',
                        private: true,
                        html_url: 'https://github.com/bob/popcorn',
                        default_branch: 'main',
                        description: null,
                    }],
                });
            }
            if (url.endsWith('/projects')) {
                return jsonResponse({
                    data: [{
                        uuid: 'proj-1',
                        environments: [{ uuid: 'env-1' }],
                    }],
                });
            }
            if (url.endsWith('/deployment-targets')) {
                return jsonResponse({
                    data: [{ destinations: [{ uuid: 'dest-1' }] }],
                });
            }
            if (url.endsWith('/applications') && init?.method === 'POST') {
                return jsonResponse({ data: { uuid: 'app-created' } }, 201);
            }
            throw new Error(`URL inattendue : ${url}`);
        });

        render(<OnboardingGithubStep canManage onSkip={() => undefined} onConnected={onConnected} />);

        fireEvent.click(await screen.findByRole('checkbox'));
        fireEvent.click(screen.getByRole('button', { name: 'Démarrer 1 dépôt' }));

        await waitFor(() => {
            expect(onConnected).toHaveBeenCalled();
        });
    });
});
