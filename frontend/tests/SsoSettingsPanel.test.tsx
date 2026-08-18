import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SsoSettingsPanel } from '../src/components/settings/SsoSettingsPanel';
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
});

const settingsPayload = {
    instance: {
        fqdn: 'https://forge.exemple.com',
        apps_wildcard_domain: 'https://exemple.com',
        instance_name: 'DevForge',
        instance_timezone: 'UTC',
    },
    sso: {
        sso_protect_apps_by_default: true,
        sso_forward_auth_address: 'http://devforge-sso-proxy:4180/',
        sso_hide_local_login: false,
        pocketid_login_enabled: false,
        apps_protection_configured: true,
        apps_oidc_configured: false,
        middleware_name: 'devforge-sso-auth',
        default_forward_auth_address: 'http://devforge-sso-proxy:4180/',
        managed_by_devforge: true,
        can_start: true,
        pocket_id_url: 'https://id.exemple.com',
        oauth2_proxy_url: 'https://sso.exemple.com',
    },
};

describe('SsoSettingsPanel', () => {
    it('montre que DevForge gère Pocket ID et enregistre les paramètres', async () => {
        const putBodies: unknown[] = [];
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
            const url = String(input);
            if (url === '/sanctum/csrf-cookie') {
                return new Response(null, { status: 204 });
            }
            if (url.includes('/settings/sso') && init?.method === 'PUT') {
                putBodies.push(JSON.parse(String(init.body)));
                return jsonResponse({ data: settingsPayload });
            }
            if (url.includes('/api/devforge/v1/settings')) {
                return jsonResponse({ data: settingsPayload });
            }
            throw new Error(`URL inattendue : ${url}`);
        });

        render(<SsoSettingsPanel permissions={{ ...bootstrapData.permissions, instance_admin: true }} />);

        expect(await screen.findByText('SSO Pocket ID')).toBeInTheDocument();
        expect(await screen.findByText((content) => content.includes('moyen de connexion'))).toBeInTheDocument();
        expect(screen.queryByPlaceholderText('http://devforge-sso-proxy:4180/')).not.toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'https://id.exemple.com/setup' })).toHaveAttribute(
            'href',
            'https://id.exemple.com/setup',
        );
        expect(screen.getByRole('link', { name: /Ouvrir Pocket ID/ })).toHaveAttribute('href', 'https://id.exemple.com');
        expect(screen.getByRole('button', { name: 'Configurer le SSO' })).toBeInTheDocument();
        expect(screen.getByLabelText('État du SSO')).toBeInTheDocument();
        expect(screen.getByText('SSO dans tes apps')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Prompt Cursor' })).toBeInTheDocument();
        expect(screen.queryByText('Prompt Cursor pour tes apps')).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Prompt Cursor' }));
        expect(screen.getByText('Prompt Cursor pour tes apps')).toBeInTheDocument();
        expect(screen.getByText((content) => content.includes('sso_linked_at'))).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Copier le prompt' })).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));

        await waitFor(() => {
            expect(putBodies).toEqual([{
                sso_protect_apps_by_default: true,
                sso_hide_local_login: false,
            }]);
        });
        expect(await screen.findByText('Paramètres SSO enregistrés.')).toBeInTheDocument();
    });

    it('n’explose pas si l’API omet le bloc sso', async () => {
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
            const url = String(input);
            if (url === '/sanctum/csrf-cookie') {
                return new Response(null, { status: 204 });
            }
            if (url.includes('/api/devforge/v1/settings')) {
                return jsonResponse({
                    data: {
                        instance: {
                            fqdn: 'https://forge.exemple.com',
                            apps_wildcard_domain: 'https://exemple.com',
                        },
                    },
                });
            }
            throw new Error(`URL inattendue : ${url}`);
        });

        render(<SsoSettingsPanel permissions={{ ...bootstrapData.permissions, instance_admin: true }} />);

        expect(await screen.findByText('Protéger les applications par défaut')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeInTheDocument();
    });

    it('lance la configuration SSO depuis la page', async () => {
        const posts: string[] = [];
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
            const url = String(input);
            if (url === '/sanctum/csrf-cookie') {
                return new Response(null, { status: 204 });
            }
            if (url.includes('/settings/sso/start') && init?.method === 'POST') {
                posts.push(url);
                return jsonResponse({
                    data: {
                        ...settingsPayload,
                        sso: { ...settingsPayload.sso, apps_oidc_configured: true },
                    },
                });
            }
            if (url.includes('/api/devforge/v1/settings')) {
                return jsonResponse({ data: settingsPayload });
            }
            throw new Error(`URL inattendue : ${url}`);
        });

        render(<SsoSettingsPanel permissions={{ ...bootstrapData.permissions, instance_admin: true }} />);

        fireEvent.click(await screen.findByRole('button', { name: 'Configurer le SSO' }));

        await waitFor(() => {
            expect(posts).toHaveLength(1);
        });
        expect(await screen.findByText('SSO lancé : Pocket ID, oauth2-proxy et clients OIDC des apps.')).toBeInTheDocument();
    });
});
