import { cleanup, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OverviewPage } from '../src/pages/_OverviewPage';

function jsonResponse(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}

afterEach(() => {
    cleanup();
});

describe('OverviewPage', () => {
    it('met en avant les applications et masque projets ou membres', async () => {
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
            const url = String(input);
            if (url === '/api/devforge/v1/overview') {
                return jsonResponse({
                    data: {
                        counts: { projects: 3, environments: 2, shared_variables: 0, private_keys: 0, members: 4 },
                        recent_projects: [{ uuid: 'p1', name: 'Projet A' }],
                        health: { score: 80, total_resources: 2, running: 1, degraded: 1, stopped: 0 },
                        resource_statuses: {
                            applications: [{
                                uuid: 'app-1',
                                name: 'popcorn-web',
                                type: 'application',
                                status: 'running:healthy',
                                updated_at: null,
                            }],
                            services: [],
                            databases: [],
                            servers: [],
                        },
                        recent_deployments: [],
                        agent_activity: [],
                        agents_summary: { total: 2, active: 1, running: 0 },
                    },
                });
            }
            throw new Error(`URL inattendue : ${url}`);
        });

        render(<OverviewPage />);

        expect(await screen.findByText('Santé des applications')).toBeInTheDocument();
        expect(screen.getByText('popcorn-web')).toBeInTheDocument();
        const quickLink = screen.getByRole('link', { name: /popcorn-web/i });
        expect(quickLink.getAttribute('href')).toBe('/devforge/applications/app-1/');
        expect(screen.getByRole('heading', { name: 'Applications' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Agents IA' })).toBeInTheDocument();
        expect(screen.queryByText('Projets')).not.toBeInTheDocument();
        expect(screen.queryByText('Membres')).not.toBeInTheDocument();
        expect(screen.queryByText('Projets récents')).not.toBeInTheDocument();
    });
});
