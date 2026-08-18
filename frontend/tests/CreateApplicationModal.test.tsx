import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CreateApplicationModal } from '../src/components/applications/CreateApplicationModal';

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

describe('CreateApplicationModal', () => {
    it('permet de relancer GitHub si aucun compte n’est relié', async () => {
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
            const url = String(input);
            if (url.endsWith('/projects') || url.endsWith('/deployment-targets') || url.endsWith('/github/apps')) {
                return jsonResponse({ data: [] });
            }
            throw new Error(`URL inattendue : ${url}`);
        });

        render(<CreateApplicationModal open onClose={() => undefined} onCreated={() => undefined} />);

        expect(await screen.findByText('GitHub n’est pas encore relié')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Relancer la configuration GitHub' })).toBeInTheDocument();
    });

    it('propose de terminer l’installation si la GitHub App n’est pas encore installée', async () => {
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
            const url = String(input);
            if (url.endsWith('/projects') || url.endsWith('/deployment-targets')) {
                return jsonResponse({ data: [] });
            }
            if (url.includes('/github/apps') && !url.includes('/install-url')) {
                return jsonResponse({
                    data: [{
                        uuid: 'app-1',
                        name: 'devforgezimaos',
                        organization: null,
                        html_url: 'https://github.com',
                        is_system_wide: false,
                        installation_id: null,
                    }],
                });
            }
            throw new Error(`URL inattendue : ${url}`);
        });

        render(<CreateApplicationModal open onClose={() => undefined} onCreated={() => undefined} />);

        expect(await screen.findByText('GitHub App créée, installation incomplète')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Terminer l’installation GitHub' })).toBeInTheDocument();
        expect(screen.queryByLabelText('Dépôt GitHub')).not.toBeInTheDocument();
    });

    it('demande un fichier .env avant le premier déploiement', async () => {
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
            const url = String(input);

            if (url.includes('/sanctum/csrf-cookie')) {
                return new Response(null, { status: 204 });
            }

            if (url.endsWith('/projects')) {
                return jsonResponse({
                    data: [{
                        uuid: 'proj-1',
                        name: 'ZIMAOS',
                        environments: [{ uuid: 'env-1', name: 'production' }],
                    }],
                });
            }

            if (url.endsWith('/deployment-targets')) {
                return jsonResponse({
                    data: [{
                        uuid: 'srv-1',
                        name: 'localhost',
                        destinations: [{ uuid: 'dest-1', name: 'coolify' }],
                    }],
                });
            }

            if (url.includes('/github/apps') && url.includes('/repositories')) {
                return jsonResponse({
                    data: [{
                        id: 42,
                        name: 'starbasefr',
                        full_name: 'bobdivx/starbasefr',
                        owner: 'bobdivx',
                        description: null,
                        default_branch: 'main',
                    }],
                });
            }

            if (url.includes('/github/apps') && url.includes('/branches')) {
                return jsonResponse({ data: [{ name: 'main' }] });
            }

            if (url.includes('/github/apps')) {
                return jsonResponse({
                    data: [{
                        uuid: 'gh-1',
                        name: 'DevForge',
                        organization: null,
                        html_url: 'https://github.com',
                        is_system_wide: false,
                        installation_id: 123,
                    }],
                });
            }

            throw new Error(`URL inattendue : ${url}`);
        });

        render(<CreateApplicationModal open onClose={() => undefined} onCreated={() => undefined} />);

        fireEvent.click(await screen.findByText('starbasefr'));
        await waitFor(() => {
            expect(screen.getByRole('button', { name: 'Suivant' })).not.toBeDisabled();
        });
        fireEvent.click(screen.getByRole('button', { name: 'Suivant' }));
        expect(await screen.findByText('Cette application a-t-elle une URL personnalisée ?')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('radio', { name: /Non, générer une URL automatique/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Suivant' }));

        expect(await screen.findByText('Importer un fichier .env avant le déploiement')).toBeInTheDocument();
        expect(screen.queryByLabelText('Fichier .env à importer')).not.toBeInTheDocument();

        const checkbox = screen.getByRole('checkbox', { name: /Importer un fichier \.env avant le déploiement/i });
        checkbox.click();

        expect(await screen.findByLabelText('Fichier .env à importer')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Choisir un fichier .env' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Créer, importer et déployer' })).toBeInTheDocument();
    });

    it('envoie l’URL personnalisée de l’application à la création', async () => {
        const created = vi.fn();
        const createBody = vi.fn();
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
            const url = String(input);

            if (url.includes('/sanctum/csrf-cookie')) {
                return new Response(null, { status: 204 });
            }

            if (url.endsWith('/projects')) {
                return jsonResponse({
                    data: [{
                        uuid: 'proj-1',
                        name: 'ZIMAOS',
                        environments: [{ uuid: 'env-1', name: 'production' }],
                    }],
                });
            }

            if (url.endsWith('/deployment-targets')) {
                return jsonResponse({
                    data: [{
                        uuid: 'srv-1',
                        name: 'localhost',
                        destinations: [{ uuid: 'dest-1', name: 'coolify' }],
                    }],
                });
            }

            if (url.includes('/github/apps') && url.includes('/repositories')) {
                return jsonResponse({
                    data: [{
                        id: 42,
                        name: 'starbasefr',
                        full_name: 'bobdivx/starbasefr',
                        owner: 'bobdivx',
                        description: null,
                        default_branch: 'main',
                    }],
                });
            }

            if (url.includes('/github/apps') && url.includes('/branches')) {
                return jsonResponse({ data: [{ name: 'main' }] });
            }

            if (url.includes('/github/apps')) {
                return jsonResponse({
                    data: [{
                        uuid: 'gh-1',
                        name: 'DevForge',
                        organization: null,
                        html_url: 'https://github.com',
                        is_system_wide: false,
                        installation_id: 123,
                    }],
                });
            }

            if (url.endsWith('/applications') && init?.method === 'POST') {
                createBody(JSON.parse(String(init.body)));
                return jsonResponse({ data: { uuid: 'app-1' } }, 201);
            }

            throw new Error(`URL inattendue : ${url}`);
        });

        render(<CreateApplicationModal open onClose={() => undefined} onCreated={created} />);

        fireEvent.click(await screen.findByText('starbasefr'));
        await waitFor(() => {
            expect(screen.getByRole('button', { name: 'Suivant' })).not.toBeDisabled();
        });
        fireEvent.click(screen.getByRole('button', { name: 'Suivant' }));
        fireEvent.click(await screen.findByRole('radio', { name: /Oui, j’ai une URL pour cette app/ }));
        fireEvent.input(screen.getByPlaceholderText('https://blog.maison.local'), {
            target: { value: 'blog.maison.local' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Suivant' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Créer et déployer' }));

        await waitFor(() => {
            expect(createBody).toHaveBeenCalledWith(expect.objectContaining({
                domains: 'https://blog.maison.local',
                git_repository: 'bobdivx/starbasefr',
            }));
        });
        expect(created).toHaveBeenCalledWith('app-1');
    });
});
