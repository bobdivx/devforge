import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApplicationRuntimeSettingsPanel } from '../src/components/applications/ApplicationRuntimeSettingsPanel';

function jsonResponse(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}

const settingsFixture = {
    build_pack: 'nixpacks',
    is_static: true,
    start_command: null,
    install_command: null,
    build_command: null,
    ports_exposes: '80',
    base_directory: '/',
    publish_directory: '/',
    health_check_enabled: false,
    health_check_type: 'http',
    health_check_path: '/',
    health_check_port: null,
    supports_static_toggle: true,
};

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('ApplicationRuntimeSettingsPanel', () => {
    it('affiche et enregistre le toggle site statique', async () => {
        let savedIsStatic: boolean | null = null;

        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
            const url = String(input);
            const method = (init?.method ?? 'GET').toUpperCase();

            if (url.includes('/sanctum/csrf-cookie')) {
                return new Response(null, { status: 204 });
            }

            if (url.includes('/runtime-settings') && method === 'PUT') {
                const body = JSON.parse(String(init?.body ?? '{}')) as {
                    is_static?: boolean;
                    start_command?: string;
                    ports_exposes?: string;
                    redeploy?: boolean;
                };
                savedIsStatic = body.is_static ?? null;
                expect(body.redeploy).toBe(true);
                return jsonResponse({
                    data: {
                        ...settingsFixture,
                        is_static: Boolean(body.is_static),
                        start_command: body.start_command ?? 'npm run start',
                        ports_exposes: body.ports_exposes ?? '3000',
                    },
                    meta: {
                        redeploy: {
                            queued: true,
                            deployment_uuid: 'deploy-from-settings',
                            message: 'Deployment queued.',
                        },
                    },
                });
            }

            if (url.includes('/runtime-settings')) {
                return jsonResponse({ data: settingsFixture });
            }

            throw new Error(`URL inattendue : ${url}`);
        });

        render(
            <ApplicationRuntimeSettingsPanel
                applicationUuid="app-uuid-1234"
                canAct
            />,
        );

        expect(await screen.findByText('Paramètres de build & runtime')).toBeInTheDocument();
        expect(screen.getByText(/Site statique \(nginx\)/)).toBeInTheDocument();

        const toggle = screen.getByRole('checkbox', { name: /Site statique/i });
        expect(toggle).toBeChecked();
        fireEvent.click(toggle);

        fireEvent.input(screen.getByPlaceholderText('npm run start'), {
            target: { value: 'npm run start' },
        });
        fireEvent.input(screen.getByDisplayValue('80'), {
            target: { value: '3000' },
        });

        fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));

        await waitFor(() => {
            expect(savedIsStatic).toBe(false);
        });

        await waitFor(() => {
            expect(screen.getByText(/redéploiement lancé/)).toBeInTheDocument();
        });
    });

    it('préremplit le formulaire via Auto-détecter sans enregistrer', async () => {
        let putCalled = false;

        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
            const url = String(input);
            const method = (init?.method ?? 'GET').toUpperCase();

            if (url.includes('/sanctum/csrf-cookie')) {
                return new Response(null, { status: 204 });
            }

            if (url.includes('/runtime-settings/detect') && method === 'POST') {
                return jsonResponse({
                    data: {
                        available: true,
                        reason: null,
                        sources: ['package.json'],
                        suggestions: {
                            is_static: false,
                            ports_exposes: '4321',
                            publish_directory: '/',
                            start_command: 'node ./dist/server/entry.mjs',
                        },
                        reasons: ['Astro SSR détecté'],
                    },
                });
            }

            if (url.includes('/runtime-settings') && method === 'PUT') {
                putCalled = true;
                return jsonResponse({ data: settingsFixture });
            }

            if (url.includes('/runtime-settings')) {
                return jsonResponse({ data: settingsFixture });
            }

            throw new Error(`URL inattendue : ${url}`);
        });

        render(
            <ApplicationRuntimeSettingsPanel
                applicationUuid="app-uuid-1234"
                canAct
            />,
        );

        expect(await screen.findByRole('button', { name: 'Auto-détecter' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Auto-détecter' }));

        await waitFor(() => {
            expect(screen.getByText(/Suggestions appliquées/)).toBeInTheDocument();
        });

        expect(screen.getByDisplayValue('4321')).toBeInTheDocument();
        expect(putCalled).toBe(false);
    });
});
