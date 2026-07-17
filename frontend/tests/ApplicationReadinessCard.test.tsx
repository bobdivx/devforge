import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApplicationReadinessCard } from '../src/components/applications/ApplicationReadinessCard';

function jsonResponse(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}

const readinessFixture = {
    uuid: 'readiness-1',
    status: 'awaiting_user' as const,
    autonomous_enabled: true,
    last_probe_at: '2026-07-17T08:00:00.000Z',
    last_probe_ok: false,
    last_probe_error: 'HTTP 502',
    last_http_status: 502,
    round: 1,
    max_rounds: 5,
    last_deployment_uuid: 'deploy-1',
    probe_url: 'https://macompta.example.com',
    intervention: {
        uuid: 'intervention-1',
        title: 'Configurer ASTRO_DB',
        summary: 'Variables manquantes pour la base.',
        steps: [
            { rank: 1, text: 'Ajouter ASTRO_DB_REMOTE_URL', done: false },
            { rank: 2, text: 'Cliquer sur C’est fait', done: false },
        ],
        status: 'open' as const,
        user_acknowledged_at: null,
        resolved_at: null,
    },
};

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('ApplicationReadinessCard', () => {
    it('affiche l’intervention et confirme C’est fait', async () => {
        let acknowledged = false;

        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
            const url = String(input);
            const method = (init?.method ?? 'GET').toUpperCase();

            if (url.includes('/sanctum/csrf-cookie')) {
                return new Response(null, { status: 204 });
            }

            if (url.includes('/readiness/interventions/') && method === 'POST') {
                acknowledged = true;
                return jsonResponse({
                    data: {
                        ...readinessFixture,
                        status: 'recovering',
                        intervention: {
                            ...readinessFixture.intervention,
                            status: 'acknowledged',
                            steps: readinessFixture.intervention.steps.map((step) => ({
                                ...step,
                                done: true,
                            })),
                        },
                    },
                });
            }

            if (url.includes('/readiness') && method === 'GET') {
                return jsonResponse({
                    data: acknowledged
                        ? {
                            ...readinessFixture,
                            status: 'recovering',
                            intervention: {
                                ...readinessFixture.intervention,
                                status: 'acknowledged',
                            },
                        }
                        : readinessFixture,
                });
            }

            throw new Error(`URL inattendue : ${url}`);
        });

        render(<ApplicationReadinessCard applicationUuid="app-uuid-1234" canAct />);

        expect(await screen.findByText('Surveillance')).toBeInTheDocument();
        expect(screen.getByText('Intervention requise')).toBeInTheDocument();
        expect(screen.getByText('Erreur détectée')).toBeInTheDocument();
        expect(screen.getByText(/HTTP 502/)).toBeInTheDocument();
        expect(screen.getByText('Ce que vous devez faire')).toBeInTheDocument();
        expect(screen.getByText('Configurer ASTRO_DB')).toBeInTheDocument();
        expect(screen.getByText('Variables manquantes pour la base.')).toBeInTheDocument();
        expect(screen.getByText('Ajouter ASTRO_DB_REMOTE_URL')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /C’est fait/i }));

        await waitFor(() => {
            expect(acknowledged).toBe(true);
        });

        await waitFor(() => {
            expect(screen.getByText('Récupération…')).toBeInTheDocument();
        });
    });
});
