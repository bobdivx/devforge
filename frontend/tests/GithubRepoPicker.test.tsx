import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GithubRepoPicker } from '../src/components/github/GithubRepoPicker';
import type { GithubAppSummary, GithubRepository } from '../src/lib/api/domain';
import type { PickedGithubRepository } from '../src/lib/github-repo-picker';

function jsonResponse(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}

const personal: GithubAppSummary = {
    uuid: 'app-bob',
    name: 'DevForge',
    account_login: 'bobdivx',
    account_type: 'User',
    organization: null,
    html_url: 'https://github.com',
    is_system_wide: false,
    installation_id: 11,
};

const organization: GithubAppSummary = {
    uuid: 'app-org',
    name: 'DevForge Org',
    account_login: 'Briseteia',
    account_type: 'Organization',
    organization: 'Briseteia',
    html_url: 'https://github.com',
    is_system_wide: false,
    installation_id: 22,
};

const popcorn: GithubRepository = {
    id: 7,
    name: 'popcorn',
    full_name: 'bobdivx/popcorn',
    owner: 'bobdivx',
    private: true,
    html_url: 'https://github.com/bobdivx/popcorn',
    default_branch: 'main',
    description: 'Client',
};

describe('GithubRepoPicker', () => {
    const originalSubmit = HTMLFormElement.prototype.submit;

    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
        HTMLFormElement.prototype.submit = originalSubmit;
    });
    it('liste les organisations puis les dépôts du compte choisi', async () => {
        const onChange = vi.fn();
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
            const url = String(input);
            if (url.includes('/github/apps/app-bob/repositories')) {
                return jsonResponse({ data: [popcorn] });
            }
            throw new Error(`URL inattendue : ${url}`);
        });

        render(
            <GithubRepoPicker
                apps={[personal, organization]}
                mode="multiple"
                selected={[]}
                onChange={onChange}
            />,
        );

        expect(screen.getByText('2 organisations')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /bobdivx/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Briseteia/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Ajouter une organisation/ })).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /bobdivx/ }));
        expect(await screen.findByText('popcorn')).toBeInTheDocument();
        expect(screen.getByText('1 dépôt')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: /Ajouter des dépôts/ })).toHaveAttribute(
            'href',
            'https://github.com/settings/installations/11',
        );

        fireEvent.click(screen.getByRole('checkbox'));
        expect(onChange).toHaveBeenCalledWith([
            expect.objectContaining({
                id: 7,
                name: 'popcorn',
                github_app_uuid: 'app-bob',
            } satisfies Partial<PickedGithubRepository>),
        ]);
    });

    it('permet de tout sélectionner dans l’organisation ouverte', async () => {
        const onChange = vi.fn();
        vi.spyOn(globalThis, 'fetch').mockImplementation(async () => jsonResponse({
            data: [
                popcorn,
                { ...popcorn, id: 8, name: 'blog', full_name: 'bobdivx/blog' },
            ],
        }));

        render(
            <GithubRepoPicker
                apps={[personal]}
                mode="multiple"
                selected={[]}
                onChange={onChange}
            />,
        );

        expect(await screen.findByText('popcorn')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Tout sélectionner' }));
        expect(onChange).toHaveBeenCalledWith([
            expect.objectContaining({ id: 7, github_app_uuid: 'app-bob' }),
            expect.objectContaining({ id: 8, github_app_uuid: 'app-bob' }),
        ]);
    });

    it('ouvre GitHub pour ajouter une organisation', async () => {
        const submit = vi.fn();
        HTMLFormElement.prototype.submit = submit;
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
            if (String(input).includes('/sanctum/csrf-cookie')) {
                return new Response(null, { status: 204 });
            }
            if (String(input).includes('/github/apps') && !String(input).includes('/repositories')) {
                return jsonResponse({
                    data: {
                        app: personal,
                        launch: {
                            action_url: 'https://github.com/settings/apps/new',
                            manifest: { name: 'DevForge' },
                        },
                    },
                }, 201);
            }
            throw new Error(`URL inattendue : ${input}`);
        });

        render(
            <GithubRepoPicker
                apps={[personal, organization]}
                mode="single"
                selected={[]}
                onChange={() => undefined}
                fromOnboarding
                returnTo="onboarding"
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: /Ajouter une organisation/ }));
        await waitFor(() => {
            expect(submit).toHaveBeenCalled();
        });
    });
});
