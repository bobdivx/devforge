import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
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
        detected_framework: 'astro-static',
        publish_directory: '/dist',
        base_directory: '/',
        is_static: true,
        ports_exposes: '80',
    },
    actions: ['start', 'stop', 'restart', 'deploy'],
    created_at: '2026-04-27T10:00:00.000Z',
    updated_at: '2026-04-27T12:00:00.000Z',
};

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
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
        expect(screen.getByRole('button', { name: 'Modifier le nom' })).toBeInTheDocument();
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
        expect(screen.getByText('Astro static')).toBeInTheDocument();
        expect(screen.getByText('/dist')).toBeInTheDocument();
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

    it('permet de renommer l’application via l’icône crayon', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
            const url = String(input);
            const method = String(init?.method ?? 'GET').toUpperCase();

            if (url.includes('/sanctum/csrf-cookie')) {
                return new Response(null, { status: 204 });
            }

            if (method === 'PATCH' && url.includes('/api/devforge/v1/applications/app-uuid-1234')) {
                const body = JSON.parse(String(init?.body ?? '{}')) as { name?: string };
                return jsonResponse({
                    data: {
                        ...application,
                        name: body.name ?? application.name,
                    },
                });
            }
            if (url.includes('/api/devforge/v1/core/applications/app-uuid-1234')) {
                return jsonResponse({ data: application });
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
                        available: true,
                        reason: null,
                        message: null,
                        container: 'popcorn-web-abc',
                        container_status: 'running',
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
        fireEvent.click(screen.getByRole('button', { name: 'Modifier le nom' }));

        const input = await screen.findByLabelText('Nom de l’application');
        fireEvent.input(input, { target: { value: 'popcorn-renamed' } });
        fireEvent.click(screen.getByRole('button', { name: 'Enregistrer le nom' }));

        await waitFor(() => {
            expect(fetchMock).toHaveBeenCalledWith(
                expect.stringContaining('/api/devforge/v1/applications/app-uuid-1234'),
                expect.objectContaining({
                    method: 'PATCH',
                    body: JSON.stringify({ name: 'popcorn-renamed' }),
                }),
            );
        });
    });

    it('met à jour les badges quand le déploiement passe de en cours à terminé', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });

        let deploymentStatus = 'in_progress';
        let appStatus = 'restarting:unknown';
        let readinessStatus: 'probing' | 'healthy' = 'probing';
        let readinessOk: boolean | null = null;

        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
            const url = String(input);

            if (url.includes('/api/devforge/v1/core/applications/app-uuid-1234')) {
                return jsonResponse({
                    data: {
                        ...application,
                        status: appStatus,
                    },
                });
            }
            if (url.includes('/api/devforge/v1/deployments')) {
                if (url.includes('/monitoring') || url.includes('/logs')) {
                    return jsonResponse({
                        data: url.includes('/logs')
                            ? { items: [], next_cursor: 0, complete: false }
                            : {
                                deployment: {
                                    uuid: 'deploy-1',
                                    status: deploymentStatus,
                                    pull_request_id: 0,
                                    commit: '84f8e3ef12ab',
                                    commit_message: 'fix(auth): allow registration',
                                    force_rebuild: false,
                                    rollback: false,
                                    created_at: '2026-04-27T10:00:00.000Z',
                                    updated_at: '2026-04-27T10:05:00.000Z',
                                    finished_at: deploymentStatus === 'finished' ? '2026-04-27T10:05:00.000Z' : null,
                                    application: { uuid: application.uuid, name: application.name },
                                },
                                agent_runs: [],
                                redeployments: [],
                                agents: { enabled: true, auto_fix_deployments: true, webhook_build: true },
                            },
                    });
                }

                return jsonResponse({
                    data: [{
                        uuid: 'deploy-1',
                        status: deploymentStatus,
                        pull_request_id: 0,
                        commit: '84f8e3ef12ab',
                        commit_message: 'fix(auth): allow registration',
                        force_rebuild: false,
                        rollback: false,
                        created_at: '2026-04-27T10:00:00.000Z',
                        updated_at: '2026-04-27T10:05:00.000Z',
                        finished_at: deploymentStatus === 'finished' ? '2026-04-27T10:05:00.000Z' : null,
                        application: { uuid: application.uuid, name: application.name },
                        is_debug_enabled: false,
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
            if (url.includes('/logs') && url.includes('/applications/')) {
                return jsonResponse({
                    data: {
                        available: true,
                        reason: null,
                        message: null,
                        container: 'popcorn-web-abc',
                        container_status: 'running',
                        line_count: 0,
                        items: [],
                    },
                });
            }
            if (url.includes('/readiness')) {
                return jsonResponse({
                    data: {
                        uuid: 'readiness-1',
                        status: readinessStatus,
                        autonomous_enabled: true,
                        last_probe_at: readinessOk ? '2026-04-27T10:05:00.000Z' : null,
                        last_probe_ok: readinessOk,
                        last_probe_error: null,
                        last_http_status: readinessOk ? 200 : null,
                        round: 0,
                        max_rounds: 5,
                        last_deployment_uuid: 'deploy-1',
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

        expect(await screen.findByLabelText('État de l’application')).toBeInTheDocument();
        expect(screen.getByTitle('Déploiement : En cours')).toBeInTheDocument();
        expect(screen.getByTitle('URL : Vérification…')).toBeInTheDocument();

        deploymentStatus = 'finished';
        appStatus = 'running:healthy';
        readinessStatus = 'healthy';
        readinessOk = true;

        await act(async () => {
            await vi.advanceTimersByTimeAsync(3000);
        });

        await waitFor(() => {
            expect(screen.getByTitle('Déploiement : Terminé')).toBeInTheDocument();
            expect(screen.getByTitle('App : Sain')).toBeInTheDocument();
            expect(screen.getByTitle('URL : Accessible')).toBeInTheDocument();
        });

        vi.useRealTimers();
    });

    it('n’affiche qu’un seul badge de statut de déploiement dans l’onglet Déploiements', async () => {
        const activeDeployment = {
            uuid: 'deploy-active-1',
            status: 'in_progress',
            pull_request_id: 0,
            commit: '84f8e3ef12ab',
            commit_message: 'feat: deploy',
            force_rebuild: false,
            rollback: false,
            created_at: '2026-04-27T10:00:00.000Z',
            updated_at: '2026-04-27T10:01:00.000Z',
            finished_at: null,
            application: { uuid: application.uuid, name: application.name },
            is_debug_enabled: false,
        };

        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
            const url = String(input);

            if (url.includes('/api/devforge/v1/core/applications/app-uuid-1234')) {
                return jsonResponse({ data: application });
            }
            if (url.includes('/api/devforge/v1/deployments')) {
                if (url.includes('/monitoring')) {
                    return jsonResponse({
                        data: {
                            deployment: activeDeployment,
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
                            items: [],
                            next_cursor: 0,
                            complete: false,
                        },
                    });
                }

                return jsonResponse({
                    data: [activeDeployment],
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
                        last_deployment_uuid: activeDeployment.uuid,
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
        fireEvent.click(screen.getByRole('tab', { name: 'Déploiements' }));

        expect(await screen.findByText('Sélection')).toBeInTheDocument();
        expect(screen.getAllByLabelText('Déploiement en cours')).toHaveLength(1);
    });
});
