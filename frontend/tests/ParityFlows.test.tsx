import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CoreResourcesPage } from '../src/pages/resources/_CoreResourcesPage';
import { DeploymentsPage } from '../src/pages/deployments/_DeploymentsPage';
import { TeamContext } from '../src/lib/team-context';
import type { BootstrapPermissions } from '../src/lib/bootstrap';
import type { CoreResource, Deployment } from '../src/lib/domain-api';

function withTeam(ui: preact.JSX.Element) {
    return (
        <TeamContext.Provider value={{ teamId: 10, revision: 0, agentsEnabled: false }}>
            {ui}
        </TeamContext.Provider>
    );
}

function jsonResponse(data: unknown): Response {
    return new Response(JSON.stringify(data), {
        status: 200,
        headers: { 'content-type': 'application/json' },
    });
}

const permissions: BootstrapPermissions = {
    role: 'owner',
    create_resources: true,
    manage_team: true,
    manage_members: true,
    access_terminal: true,
    instance_admin: false,
};

const application: CoreResource = {
    uuid: 'application-uuid-1234',
    type: 'application',
    name: 'Application de parité',
    description: null,
    status: 'running',
    configuration: {},
    actions: ['restart'],
    created_at: null,
    updated_at: null,
};

afterEach(cleanup);

describe('actions core DevForge', () => {
    it('n’envoie une action sensible qu’après confirmation puis recharge les données', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
            const url = String(input);
            if (url === '/sanctum/csrf-cookie') {
                return new Response(null, { status: 204 });
            }
            if (url === '/api/devforge/v1/core/applications') {
                return jsonResponse({ data: [application], meta: { count: 1 } });
            }
            if (url === `/api/devforge/v1/core/applications/${application.uuid}`) {
                return jsonResponse({ data: application });
            }
            if (url === `/api/devforge/v1/core/applications/${application.uuid}/restart`) {
                return jsonResponse({ data: { accepted: true } });
            }
            throw new Error(`URL inattendue : ${url}`);
        });
        render(withTeam(<CoreResourcesPage type="applications" permissions={permissions} />));

        fireEvent.click(await screen.findByRole('button', { name: /Application de parité/i }));
        fireEvent.click(await screen.findByRole('button', { name: 'Redémarrer' }));
        expect(fetchMock.mock.calls.map(([input]) => String(input))).not.toContain(
            `/api/devforge/v1/core/applications/${application.uuid}/restart`,
        );

        fireEvent.click(await screen.findByRole('button', { name: 'Confirmer' }));

        await waitFor(() => expect(fetchMock.mock.calls.map(([input]) => String(input))).toContain(
            `/api/devforge/v1/core/applications/${application.uuid}/restart`,
        ));
        const actionCall = fetchMock.mock.calls.find(
            ([input]) => String(input) === `/api/devforge/v1/core/applications/${application.uuid}/restart`,
        );
        expect(actionCall?.[1]).toEqual(expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({ action: 'restart' }),
        }));
        await waitFor(() => expect(
            fetchMock.mock.calls.filter(([input]) => String(input) === '/api/devforge/v1/core/applications'),
        ).toHaveLength(2));
    });
});

describe('déploiements DevForge', () => {
    it('charge la liste puis le détail et les logs du déploiement sélectionné', async () => {
        const deployment: Deployment = {
            uuid: 'deployment-uuid-1',
            status: 'in_progress',
            pull_request_id: 0,
            commit: 'abc123',
            commit_message: null,
            force_rebuild: false,
            rollback: false,
            created_at: null,
            updated_at: null,
            finished_at: null,
            application: { uuid: 'application-uuid-1234', name: 'Application déployée' },
            is_debug_enabled: false,
        };
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
            const url = String(input);
            if (url === '/api/devforge/v1/deployments?page=1&per_page=25') {
                return jsonResponse({ data: [deployment], meta: { last_page: 1 } });
            }
            if (url === `/api/devforge/v1/deployments/${deployment.uuid}`) {
                return jsonResponse({ data: deployment });
            }
            if (url === `/api/devforge/v1/deployments/${deployment.uuid}/logs?after=0`) {
                return jsonResponse({
                    data: {
                        items: [{
                            cursor: 1,
                            timestamp: null,
                            stream: 'stdout',
                            message: 'Déploiement terminé',
                            command: false,
                            hidden: false,
                        }],
                        next_cursor: 1,
                        complete: true,
                    },
                });
            }
            if (url === `/api/devforge/v1/deployments/${deployment.uuid}/monitoring`) {
                return jsonResponse({
                    data: {
                        deployment,
                        agent_runs: [],
                        redeployments: [],
                        agents: {
                            enabled: false,
                            auto_fix_deployments: false,
                            monitor_build: false,
                            webhook_build: false,
                        },
                        diagnostics: {
                            blockers: [],
                            eligible_agents_count: 0,
                            eligible_agents: [],
                        },
                    },
                });
            }
            throw new Error(`URL inattendue : ${url}`);
        });
        render(withTeam(<DeploymentsPage />));

        expect(await screen.findByText('Application déployée')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Suivre' }));

        expect(await screen.findByText('Logs de déploiement')).toBeInTheDocument();
        expect((await screen.findAllByText('Déploiement terminé')).length).toBeGreaterThanOrEqual(1);
        expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual(expect.arrayContaining([
            `/api/devforge/v1/deployments/${deployment.uuid}/logs?after=0`,
            `/api/devforge/v1/deployments/${deployment.uuid}/monitoring`,
        ]));
    });

    it('ouvre un redéploiement agent même s’il n’est pas dans la page courante', async () => {
        const failedDeployment = {
            uuid: 'failed-deploy-uuid',
            status: 'failed',
            pull_request_id: 0,
            commit: 'abc123',
            commit_message: 'Build failed',
            force_rebuild: false,
            rollback: false,
            created_at: '2026-07-16T18:40:00.000Z',
            updated_at: '2026-07-16T18:40:55.000Z',
            finished_at: '2026-07-16T18:40:55.000Z',
            application: { uuid: 'application-uuid-1234', name: 'starbasefr' },
            is_debug_enabled: false,
        };
        const redeployment = {
            ...failedDeployment,
            uuid: 'aja1s6cs5uy6lgy1m34agwu1',
            status: 'queued',
            commit_message: 'Nouveau déploiement',
            finished_at: null,
        };

        const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
            const url = String(input);
            if (url === '/api/devforge/v1/deployments?page=1&per_page=25') {
                return jsonResponse({ data: [failedDeployment], meta: { last_page: 1 } });
            }
            if (url === `/api/devforge/v1/deployments/${failedDeployment.uuid}`) {
                return jsonResponse({ data: failedDeployment });
            }
            if (url === `/api/devforge/v1/deployments/${redeployment.uuid}`) {
                return jsonResponse({ data: redeployment });
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
            if (url === `/api/devforge/v1/deployments/${failedDeployment.uuid}/monitoring`) {
                return jsonResponse({
                    data: {
                        deployment: failedDeployment,
                        agent_runs: [{
                            uuid: 'run-1',
                            status: 'completed',
                            trigger: 'event',
                            summary: 'Redeploy queued',
                            actions_taken: [{
                                action: 'deploy',
                                reason: 'Puppeteer fix',
                                at: '2026-07-16T18:41:17.000Z',
                                deployment_uuid: redeployment.uuid,
                            }],
                            iterations: 3,
                            tokens_used: 0,
                            duration_seconds: 30,
                            started_at: '2026-07-16T18:40:58.000Z',
                            finished_at: '2026-07-16T18:41:34.000Z',
                            created_at: '2026-07-16T18:40:58.000Z',
                            event_context: { event: 'deployment_failed' },
                            metadata: {},
                            subagent_runs: [],
                            logs: '',
                            linkage: 'direct',
                            agent: { uuid: 'agent-1', name: 'Build', type: 'deployment', avatar_color: null },
                        }],
                        redeployments: [redeployment],
                        agents: {
                            enabled: true,
                            auto_fix_deployments: true,
                            monitor_build: true,
                            webhook_build: true,
                        },
                        diagnostics: { blockers: [], eligible_agents_count: 1 },
                    },
                });
            }
            if (url === `/api/devforge/v1/deployments/${redeployment.uuid}/monitoring`) {
                return jsonResponse({
                    data: {
                        deployment: redeployment,
                        agent_runs: [],
                        redeployments: [],
                        agents: {
                            enabled: true,
                            auto_fix_deployments: true,
                            monitor_build: true,
                            webhook_build: true,
                        },
                        diagnostics: { blockers: [], eligible_agents_count: 0 },
                    },
                });
            }
            throw new Error(`URL inattendue : ${url}`);
        });

        render(withTeam(<DeploymentsPage />));

        fireEvent.click(await screen.findByRole('button', { name: 'Suivre' }));
        expect(await screen.findByText('Redéploiements')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /Nouveau déploiement/i }));

        await waitFor(() => {
            expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual(expect.arrayContaining([
                `/api/devforge/v1/deployments/${redeployment.uuid}`,
                `/api/devforge/v1/deployments/${redeployment.uuid}/logs?after=0`,
                `/api/devforge/v1/deployments/${redeployment.uuid}/monitoring`,
            ]));
        });
    });
});
