import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApplicationStatusBadges } from '../src/components/applications/ApplicationStatusBadges';
import type { ApplicationReadiness } from '../src/lib/domain-api';

function jsonResponse(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}

const readinessHealthy: ApplicationReadiness = {
    uuid: 'readiness-1',
    status: 'healthy',
    autonomous_enabled: true,
    last_probe_at: '2026-07-17T08:00:00.000Z',
    last_probe_ok: true,
    last_probe_error: null,
    last_http_status: 200,
    round: 0,
    max_rounds: 5,
    last_deployment_uuid: 'deploy-1',
    probe_url: 'https://example.com',
    intervention: null,
};

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('ApplicationStatusBadges', () => {
    it('affiche les badges app, déploiement, URL et base', async () => {
        const onOpenTab = vi.fn();

        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
            const url = String(input);

            if (url.includes('/linkable-databases')) {
                return jsonResponse({
                    data: [{
                        uuid: 'db-1',
                        name: 'app-db',
                        engine: 'libsql',
                        status: 'running:healthy',
                        default_env_key: 'DATABASE_URL',
                        connected_applications: [],
                        is_linkable: true,
                    }],
                    meta: {
                        connections: [{
                            database_uuid: 'db-1',
                            env_keys: ['DATABASE_URL'],
                            is_runtime: true,
                            is_buildtime: true,
                            updated_at: null,
                        }],
                    },
                });
            }

            throw new Error(`URL inattendue : ${url}`);
        });

        render(
            <ApplicationStatusBadges
                applicationUuid="app-1"
                resourceStatus="running:healthy"
                latestDeployment={{
                    uuid: 'deploy-1',
                    status: 'finished',
                    pull_request_id: 0,
                    commit: 'abc123',
                    commit_message: 'ok',
                    force_rebuild: false,
                    rollback: false,
                    created_at: '2026-07-17T08:00:00.000Z',
                    updated_at: '2026-07-17T08:05:00.000Z',
                    finished_at: '2026-07-17T08:05:00.000Z',
                    application: { uuid: 'app-1', name: 'demo' },
                    is_debug_enabled: false,
                }}
                readiness={readinessHealthy}
                readinessLoading={false}
                onOpenTab={onOpenTab}
            />,
        );

        expect(await screen.findByLabelText('État de l’application')).toBeInTheDocument();
        expect(screen.getByText('Sain')).toBeInTheDocument();
        expect(screen.getByText('Terminé')).toBeInTheDocument();
        expect(screen.getByTitle('URL : Accessible')).toBeInTheDocument();
        expect(await screen.findByTitle('Base : Accessible')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /Déploiement/i }));
        expect(onOpenTab).toHaveBeenCalledWith('deployments');
    });
});
