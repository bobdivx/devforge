import { cleanup, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TeamContext } from '../src/lib/team-context';
import { StorePage } from '../src/pages/store/_StorePage';

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

describe('StorePage', () => {
    it('affiche le catalogue et les fiches publiées', async () => {
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
            const url = String(input);
            if (url.includes('/api/devforge/v1/store/listings')) {
                return jsonResponse({
                    data: [{
                        uuid: 'listing-1',
                        slug: 'hello-static',
                        name: 'Hello Static',
                        description: 'Site de démo',
                        category: 'web',
                        icon_url: null,
                        website_url: null,
                        git_repository: 'acme/hello',
                        git_branch: 'main',
                        runtime_defaults: { build_pack: 'static', ports_exposes: '80' },
                        env_schema: [],
                        status: 'published',
                        install_count: 3,
                        owned: false,
                        publisher: { team_name: 'Acme' },
                        created_at: null,
                        updated_at: null,
                    }],
                    meta: { categories: ['web'] },
                });
            }

            return jsonResponse({ message: 'not found' }, 404);
        });

        render(
            <TeamContext.Provider value={{ teamId: 1, revision: 0, agentsEnabled: false }}>
                <StorePage path="/store" />
            </TeamContext.Provider>,
        );

        expect(await screen.findByRole('heading', { name: 'Store' })).toBeInTheDocument();
        expect(await screen.findByRole('button', { name: /Hello Static/ })).toBeInTheDocument();
        expect(screen.getByText(/Site de démo/)).toBeInTheDocument();
    });
});
