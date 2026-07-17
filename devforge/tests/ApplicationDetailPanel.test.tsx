import { cleanup, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApplicationDetailPanel } from '../src/components/applications/ApplicationDetailPanel';

function jsonResponse(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}

const application = {
    uuid: 'app-uuid-1234',
    type: 'application',
    name: 'popcorn-web',
    description: 'Application principale',
    status: 'running',
    configuration: {
        build_pack: 'nixpacks',
        git_repository: 'https://github.com/example/popcorn-web',
        git_branch: 'dev',
        domains: ['https://popcornn.app', 'https://www.popcornn.app'],
        project: { uuid: 'project-1', name: 'Popcorn' },
        environment: { uuid: 'env-1', name: 'production' },
        server: { uuid: 'server-1', name: 'Serveur principal' },
    },
    actions: ['start', 'stop', 'restart', 'deploy'],
    created_at: '2026-04-27T10:00:00.000Z',
    updated_at: '2026-04-27T12:00:00.000Z',
};

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('ApplicationDetailPanel', () => {
    it('affiche une vue détaillée inspirée Vercel', async () => {
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
            const url = String(input);
            if (url.includes('/api/devforge/v1/core/applications/app-uuid-1234')) {
                return jsonResponse({ data: application });
            }
            if (url.includes('/api/devforge/v1/deployments')) {
                if (url.includes('/monitoring')) {
                    return jsonResponse({
                        data: {
                            deployment: {
                                uuid: 'deploy-1',
                                status: 'finished',
                                pull_request_id: 0,
                                commit: '84f8e3ef12ab',
                                commit_message: 'fix(auth): allow registration',
                                force_rebuild: false,
                                rollback: false,
                                created_at: '2026-04-27T10:00:00.000Z',
                                updated_at: '2026-04-27T10:05:00.000Z',
                                finished_at: '2026-04-27T10:05:00.000Z',
                                application: { uuid: application.uuid, name: application.name },
                            },
                            agent_runs: [],
                            redeployments: [],
                            agents: {
                                enabled: true,
                                auto_fix_deployments: true,
                                webhook_build: true,
                            },
                        },
                    });
                }

                if (url.includes('/logs')) {
                    return jsonResponse({
                        data: {
                            items: [{ cursor: 1, stream: 'stdout', message: 'Build complete', timestamp: null, command: false, hidden: false }],
                            next_cursor: 1,
                            complete: true,
                        },
                    });
                }

                return jsonResponse({
                    data: [{
                        uuid: 'deploy-1',
                        status: 'finished',
                        pull_request_id: 0,
                        commit: '84f8e3ef12ab',
                        commit_message: 'fix(auth): allow registration',
                        force_rebuild: false,
                        rollback: false,
                        created_at: '2026-04-27T10:00:00.000Z',
                        updated_at: '2026-04-27T10:05:00.000Z',
                        finished_at: '2026-04-27T10:05:00.000Z',
                        application: { uuid: application.uuid, name: application.name },
                    }],
                    meta: { total: 1 },
                });
            }
            if (url.includes('/linkable-databases')) {
                return jsonResponse({ data: [], meta: { connections: [] } });
            }
            if (url.includes('/environment-variables')) {
                return jsonResponse({ data: { production: [], preview: [] } });
            }
            if (url.includes('/logs')) {
                return jsonResponse({
                    data: {
                        available: true,
                        reason: null,
                        message: null,
                        container: 'popcorn-web-abc',
                        container_status: 'running',
                        line_count: 200,
                        items: [{ cursor: 1, message: 'Server started on port 3000' }],
                    },
                });
            }
            if (url.includes('/readiness')) {
                return jsonResponse({
                    data: {
                        uuid: 'readiness-1',
                        status: 'idle',
                        autonomous_enabled: true,
                        last_probe_at: null,
                        last_probe_ok: null,
                        last_probe_error: null,
                        last_http_status: null,
                        round: 0,
                        max_rounds: 5,
                        last_deployment_uuid: null,
                        probe_url: 'https://popcornn.app',
                        intervention: null,
                    },
                });
            }
            if (url.includes('/api/devforge/v1/agents')) {
                return jsonResponse({ data: [] });
            }
            throw new Error(`URL inattendue : ${url}`);
        });

        render(
            <ApplicationDetailPanel
                uuid="app-uuid-1234"
                canAct
                onClose={() => undefined}
                onChanged={async () => undefined}
            />,
        );

        expect(await screen.findByRole('heading', { name: 'popcorn-web' })).toBeInTheDocument();
        expect(await screen.findByText('Chat')).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: 'Vue d’ensemble' })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: 'Paramètres' })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: 'Déploiements' })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: 'Bases de données' })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: 'Logs' })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: 'Variables' })).toBeInTheDocument();
        expect(screen.getByRole('img', { name: 'Capture d’écran de popcorn-web' })).toHaveAttribute(
            'src',
            'https://s.wordpress.com/mshots/v1/https%3A%2F%2Fpopcornn.app?w=960',
        );
        expect(screen.getByText('Production')).toBeInTheDocument();
        expect(screen.getByText(/84f8e3e · fix\(auth\): allow registration/)).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Visiter' })).toHaveAttribute('href', 'https://popcornn.app');
        expect(screen.getByRole('button', { name: 'Déployer' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Arrêter' })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: 'Danger' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Supprimer' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Démarrer' })).not.toBeInTheDocument();
        expect(screen.getByText(/84f8e3e · fix\(auth\): allow registration/)).toBeInTheDocument();
        expect(screen.getByText(/Serveur principal/)).toBeInTheDocument();
        expect(await screen.findByLabelText('État de l’application')).toBeInTheDocument();
        expect(screen.queryByText('Logs du conteneur')).not.toBeInTheDocument();
        expect(screen.getByRole('tab', { name: 'Bases de données' })).toBeInTheDocument();
    });

    it('garde visiter et n’affiche que déployer quand l’application est arrêtée', async () => {
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
            const url = String(input);
            if (url.includes('/api/devforge/v1/core/applications/app-uuid-1234')) {
                return jsonResponse({
                    data: {
                        ...application,
                        status: 'exited:unknown',
                    },
                });
            }
            if (url.includes('/api/devforge/v1/deployments')) {
                return jsonResponse({ data: [], meta: { total: 0 } });
            }
            if (url.includes('/linkable-databases')) {
                return jsonResponse({ data: [], meta: { connections: [] } });
            }
            if (url.includes('/environment-variables')) {
                return jsonResponse({ data: { production: [], preview: [] } });
            }
            if (url.includes('/logs')) {
                return jsonResponse({
                    data: {
                        available: false,
                        reason: 'stopped',
                        message: null,
                        container: null,
                        container_status: 'exited',
                        line_count: 0,
                        items: [],
                    },
                });
            }
            if (url.includes('/readiness')) {
                return jsonResponse({
                    data: {
                        uuid: 'readiness-1',
                        status: 'idle',
                        autonomous_enabled: true,
                        last_probe_at: null,
                        last_probe_ok: null,
                        last_probe_error: null,
                        last_http_status: null,
                        round: 0,
                        max_rounds: 5,
                        last_deployment_uuid: null,
                        probe_url: null,
                        intervention: null,
                    },
                });
            }
            if (url.includes('/api/devforge/v1/agents')) {
                return jsonResponse({ data: [] });
            }
            throw new Error(`URL inattendue : ${url}`);
        });

        render(
            <ApplicationDetailPanel
                uuid="app-uuid-1234"
                canAct
                onClose={() => undefined}
                onChanged={async () => undefined}
            />,
        );

        expect(await screen.findByRole('heading', { name: 'popcorn-web' })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Visiter' })).toHaveAttribute('href', 'https://popcornn.app');
        expect(screen.getByRole('button', { name: 'Déployer' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Démarrer' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Arrêter' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Redémarrer' })).not.toBeInTheDocument();
    });

});
