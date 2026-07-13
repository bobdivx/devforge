import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CoreResourcesPage } from '../src/pages/_CoreResourcesPage';
import { DeploymentsPage } from '../src/pages/_DeploymentsPage';
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
                        }],
                        next_cursor: 1,
                        complete: true,
                    },
                });
            }
            throw new Error(`URL inattendue : ${url}`);
        });
        render(withTeam(<DeploymentsPage />));

        expect(await screen.findByText('Application déployée')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Logs' }));

        expect(await screen.findByText('Déploiement terminé')).toBeInTheDocument();
        expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual(expect.arrayContaining([
            `/api/devforge/v1/deployments/${deployment.uuid}`,
            `/api/devforge/v1/deployments/${deployment.uuid}/logs?after=0`,
        ]));
    });
});
