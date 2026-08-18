import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OnboardingPage } from '../src/pages/onboarding/_OnboardingPage';
import { bootstrapData } from './fixtures';

function jsonResponse(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    window.history.replaceState({}, '', window.location.pathname);
});

describe('OnboardingPage', () => {
    it('demande un domaine pour les applications puis continue sans en définir', async () => {
        const update = vi.fn();
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
            const url = String(input);
            if (url === '/sanctum/csrf-cookie') {
                return new Response(null, { status: 204 });
            }
            if (url.includes('/settings/instance') && init?.method === 'PUT') {
                update(JSON.parse(String(init.body)));
                return jsonResponse({
                    data: { instance: { fqdn: window.location.origin, apps_wildcard_domain: null } },
                });
            }
            if (url.includes('/settings/oauth')) {
                return jsonResponse({ data: [] });
            }
            if (url.includes('/api/devforge/v1/settings') && !url.includes('/settings/')) {
                return jsonResponse({
                    data: {
                        instance: {
                            fqdn: null,
                            apps_wildcard_domain: null,
                            instance_name: 'DevForge',
                            instance_timezone: 'UTC',
                        },
                        sso: {
                            sso_protect_apps_by_default: true,
                            sso_forward_auth_address: null,
                            sso_hide_local_login: false,
                            pocketid_login_enabled: false,
                            apps_protection_configured: false,
                            middleware_name: 'devforge-sso-auth',
                            default_forward_auth_address: 'http://devforge-sso-proxy:4180/',
                        },
                    },
                });
            }
            if (url.includes('/github/apps') && !url.includes('install-url')) {
                return jsonResponse({ data: [] });
            }
            throw new Error(`URL inattendue : ${url}`);
        });

        render(<OnboardingPage bootstrap={{
            ...bootstrapData,
            permissions: { ...bootstrapData.permissions, instance_admin: true },
            onboarding: {
                ...bootstrapData.onboarding,
                required: true,
                steps: { account: true, domain: false, sso: false, github: false, s3: false, server: false },
            },
        }}
        />);

        expect(await screen.findByRole('heading', { name: 'Domaine des applications' })).toBeInTheDocument();
        expect(await screen.findByPlaceholderText('exemple.com')).toBeInTheDocument();
        expect(await screen.findByText('Avez-vous un domaine pour toutes vos applications ?')).toBeInTheDocument();
        await waitFor(() => {
            expect(screen.getByRole('radio', { name: /Non, pas pour le moment/ })).not.toBeDisabled();
        });
        fireEvent.click(screen.getByRole('radio', { name: /Non, pas pour le moment/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Continuer' }));
        await waitFor(() => {
            expect(update).toHaveBeenCalledWith({
                fqdn: window.location.origin,
                apps_wildcard_domain: null,
                force_save_domains: true,
            });
        });
        expect(await screen.findByRole('heading', { name: 'SSO Pocket ID' })).toBeInTheDocument();
    });

    it('reprend GitHub après le retour d’installation', async () => {
        window.history.replaceState({}, '', `${window.location.pathname}?pick=repos`);
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
            const url = String(input);
            if (url.includes('/github/apps') && !url.includes('install-url')) {
                return jsonResponse({ data: [] });
            }
            throw new Error(`URL inattendue : ${url}`);
        });

        render(<OnboardingPage bootstrap={{
            ...bootstrapData,
            onboarding: {
                ...bootstrapData.onboarding,
                required: true,
                steps: { account: true, domain: true, sso: false, github: false, s3: false, server: false },
            },
        }}
        />);

        expect(await screen.findByRole('heading', { name: 'Connecter GitHub' })).toBeInTheDocument();
        expect(await screen.findByRole('button', { name: 'Continuer avec GitHub' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Plus tard' })).toBeInTheDocument();
    });

    it('termine l’onboarding depuis l’étape finale', async () => {
        const assign = vi.fn();
        vi.stubGlobal('location', { ...window.location, assign });
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
            const url = String(input);
            if (url === '/sanctum/csrf-cookie') {
                return new Response(null, { status: 204 });
            }
            if (url === '/api/devforge/v1/onboarding/complete') {
                return jsonResponse({ data: bootstrapData, message: 'ok' });
            }
            throw new Error(`URL inattendue : ${url}`);
        });

        render(<OnboardingPage bootstrap={{
            ...bootstrapData,
            onboarding: {
                ...bootstrapData.onboarding,
                required: true,
                steps: { account: true, domain: true, sso: true, github: true, s3: true, server: true },
            },
        }}
        />);

        expect(await screen.findByRole('heading', { name: 'Vous êtes prêt' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Entrer dans DevForge' }));
        await waitFor(() => {
            expect(assign).toHaveBeenCalled();
        });
    });

    it('affiche le champ de domaine même si l’onboarding est déjà terminé', async () => {
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
            const url = String(input);
            if (url.includes('/api/devforge/v1/settings') && !url.includes('/settings/')) {
                return jsonResponse({
                    data: {
                        instance: {
                            fqdn: window.location.origin,
                            apps_wildcard_domain: null,
                            instance_name: 'DevForge',
                            instance_timezone: 'UTC',
                        },
                    },
                });
            }
            throw new Error(`URL inattendue : ${url}`);
        });

        render(<OnboardingPage bootstrap={{
            ...bootstrapData,
            permissions: { ...bootstrapData.permissions, instance_admin: true },
            onboarding: {
                ...bootstrapData.onboarding,
                required: false,
                steps: { account: true, domain: false, sso: true, github: true, s3: true, server: true },
            },
        }}
        />);

        expect(await screen.findByRole('heading', { name: 'Domaine des applications' })).toBeInTheDocument();
        expect(await screen.findByPlaceholderText('exemple.com')).toBeInTheDocument();
    });

    it('propose de relancer l’assistant quand l’onboarding est déjà terminé', async () => {
        render(<OnboardingPage bootstrap={{
            ...bootstrapData,
            onboarding: {
                ...bootstrapData.onboarding,
                required: false,
                steps: { account: true, domain: true, sso: true, github: true, s3: true, server: true },
            },
        }}
        />);

        expect(await screen.findByRole('heading', { name: 'Vous êtes prêt' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Relancer l’assistant' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Entrer dans DevForge' })).not.toBeInTheDocument();
    });
});
