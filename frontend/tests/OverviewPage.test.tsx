import { cleanup, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OverviewPage } from '../src/pages/dashboard/_OverviewPage';

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

    it('tronque les résumés d\'activité agent dans la carte', async () => {
        const longSummary = 'The error message indicates that the Docker build process failed with an exit code of 1. '.repeat(6);

        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
            const url = String(input);
            if (url === '/api/devforge/v1/overview') {
                return jsonResponse({
                    data: {
                        counts: { projects: 0, environments: 0, shared_variables: 0, private_keys: 0, members: 0 },
                        recent_projects: [],
                        health: { score: 100, total_resources: 0, running: 0, degraded: 0, stopped: 0 },
                        resource_statuses: { applications: [], services: [], databases: [], servers: [] },
                        recent_deployments: [],
                        agent_activity: [{
                            uuid: 'run-1',
                            status: 'failed',
                            summary: longSummary,
                            created_at: '2026-07-15T05:00:00Z',
                            agent: { uuid: 'agent-1', name: 'Build' },
                        }],
                        agents_summary: { total: 1, active: 1, running: 0 },
                    },
                });
            }
            throw new Error(`URL inattendue : ${url}`);
        });

        const { container } = render(<OverviewPage />);

        expect(await screen.findByText('Build')).toBeInTheDocument();
        const summary = container.querySelector('.line-clamp-2');
        expect(summary).toHaveClass('break-words');
        expect(summary?.textContent).toContain('Docker build process failed');
    });
});
