import { describe, expect, it, vi } from 'vitest';
import { domainApi } from '../src/lib/domain-api';

function jsonResponse(data: unknown): Response {
    return new Response(JSON.stringify(data), {
        status: 200,
        headers: { 'content-type': 'application/json' },
    });
}

describe('API métiers DevForge', () => {
    it('utilise les endpoints de lecture core et déploiements', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => jsonResponse({ data: [] }));

        await domainApi.coreResources('applications');
        await domainApi.coreResource('applications', 'app-uuid-1234');
        await domainApi.deployments(2);
        await domainApi.deploymentLogs('deployment-1', 12);

        expect(fetchMock.mock.calls.map(([input]) => input)).toEqual([
            '/api/devforge/v1/core/applications',
            '/api/devforge/v1/core/applications/app-uuid-1234',
            '/api/devforge/v1/deployments?page=2&per_page=25',
            '/api/devforge/v1/deployments/deployment-1/logs?after=12',
        ]);
    });

    it('protège les créations de base de données par CSRF', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch')
            .mockResolvedValueOnce(new Response(null, { status: 204 }))
            .mockResolvedValueOnce(jsonResponse({ data: { uuid: 'db-1' } }));

        await domainApi.createDatabase({
            engine: 'postgresql',
            project_uuid: 'project-1',
            environment_uuid: 'env-1',
            destination_uuid: 'dest-1',
        });

        expect(fetchMock.mock.calls[1][0]).toBe('/api/devforge/v1/databases');
        expect(fetchMock.mock.calls[1][1]).toEqual(expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({
                engine: 'postgresql',
                project_uuid: 'project-1',
                environment_uuid: 'env-1',
                destination_uuid: 'dest-1',
            }),
        }));
    });

    it('protège les créations de projet par CSRF', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch')
            .mockResolvedValueOnce(new Response(null, { status: 204 }))
            .mockResolvedValueOnce(jsonResponse({ data: { uuid: 'project-1' } }));

        await domainApi.createProject({ name: 'Production', description: 'Projet principal' });

        expect(fetchMock.mock.calls[0][0]).toBe('/sanctum/csrf-cookie');
        expect(fetchMock.mock.calls[1][0]).toBe('/api/devforge/v1/projects');
        expect(fetchMock.mock.calls[1][1]).toEqual(expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({ name: 'Production', description: 'Projet principal' }),
        }));
    });

    it('utilise les contrats CRUD projet et environnement sans perdre les identifiants dynamiques', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
            if (String(input) === '/sanctum/csrf-cookie') {
                return new Response(null, { status: 204 });
            }

            return jsonResponse({ data: {} });
        });
        const input = { name: 'Production', description: 'Projet principal' };

        await domainApi.updateProject('project/été', input);
        await domainApi.deleteProject('project/été');
        await domainApi.createEnvironment('project/été', input);
        await domainApi.updateEnvironment('project/été', 'env bleu', input);
        await domainApi.deleteEnvironment('project/été', 'env bleu');

        const mutations = fetchMock.mock.calls.filter(([request]) => String(request) !== '/sanctum/csrf-cookie');
        expect(mutations.map(([request]) => request)).toEqual([
            '/api/devforge/v1/projects/project%2F%C3%A9t%C3%A9',
            '/api/devforge/v1/projects/project%2F%C3%A9t%C3%A9',
            '/api/devforge/v1/projects/project%2F%C3%A9t%C3%A9/environments',
            '/api/devforge/v1/projects/project%2F%C3%A9t%C3%A9/environments/env%20bleu',
            '/api/devforge/v1/projects/project%2F%C3%A9t%C3%A9/environments/env%20bleu',
        ]);
        expect(mutations.map(([, request]) => request?.method)).toEqual([
            'PUT',
            'DELETE',
            'POST',
            'PUT',
            'DELETE',
        ]);
        expect(mutations[0][1]?.body).toBe(JSON.stringify(input));
        expect(mutations[2][1]?.body).toBe(JSON.stringify(input));
        expect(mutations[3][1]?.body).toBe(JSON.stringify(input));
    });

    it('envoie les actions core confirmées au bon endpoint', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch')
            .mockResolvedValueOnce(new Response(null, { status: 204 }))
            .mockResolvedValueOnce(jsonResponse({ data: { accepted: true } }));

        await domainApi.coreAction('services', 'service-uuid-1234', 'restart');

        expect(fetchMock.mock.calls[1][0]).toBe('/api/devforge/v1/core/services/service-uuid-1234/restart');
        expect(fetchMock.mock.calls[1][1]?.body).toBe(JSON.stringify({ action: 'restart' }));
    });

    it('utilise les endpoints de création d’application GitHub', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch')
            .mockResolvedValueOnce(new Response(null, { status: 204 }))
            .mockResolvedValueOnce(jsonResponse({ data: { uuid: 'app-1' } }));

        await domainApi.createApplication({
            project_uuid: 'project-1',
            environment_uuid: 'env-1',
            destination_uuid: 'dest-1',
            github_app_uuid: 'github-1',
            git_repository: 'acme/demo-app',
            git_branch: 'main',
            build_pack: 'nixpacks',
        });

        expect(fetchMock.mock.calls[1][0]).toBe('/api/devforge/v1/applications');
        expect(fetchMock.mock.calls[1][1]).toEqual(expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({
                project_uuid: 'project-1',
                environment_uuid: 'env-1',
                destination_uuid: 'dest-1',
                github_app_uuid: 'github-1',
                git_repository: 'acme/demo-app',
                git_branch: 'main',
                build_pack: 'nixpacks',
            }),
        }));
    });

    it('utilise les endpoints de rattachement base de données', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch')
            .mockResolvedValueOnce(new Response(null, { status: 204 }))
            .mockResolvedValueOnce(jsonResponse({ data: { env_key: 'DATABASE_URL' } }));

        await domainApi.connectDatabase('app-uuid-1234', {
            database_uuid: 'db-uuid-5678',
            env_key: 'DATABASE_URL',
            instant_deploy: true,
        });

        expect(fetchMock.mock.calls[1][0]).toBe('/api/devforge/v1/applications/app-uuid-1234/connect-database');
        expect(fetchMock.mock.calls[1][1]).toEqual(expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({
                database_uuid: 'db-uuid-5678',
                env_key: 'DATABASE_URL',
                instant_deploy: true,
            }),
        }));

        fetchMock.mockReset();
        fetchMock.mockImplementation(async () => jsonResponse({ data: [], meta: { connections: [] } }));

        await domainApi.linkableDatabases('app-uuid-1234');

        expect(fetchMock.mock.calls[0][0]).toBe('/api/devforge/v1/applications/app-uuid-1234/linkable-databases');
    });

    it('charge les logs conteneur d’une application', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => jsonResponse({ data: { available: true, items: [] } }));

        await domainApi.applicationLogs('app-uuid-1234', 500);

        expect(fetchMock.mock.calls[0][0]).toBe('/api/devforge/v1/applications/app-uuid-1234/logs?lines=500');
    });
});
