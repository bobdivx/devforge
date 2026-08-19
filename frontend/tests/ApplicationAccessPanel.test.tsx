import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApplicationAccessPanel } from '../src/components/applications/ApplicationAccessPanel';

function jsonResponse(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}

const advancedPayload = {
    disable_build_cache: false,
    inject_build_args_to_dockerfile: true,
    include_source_commit_in_build: false,
    skip_puppeteer_browser_download: true,
    is_consistent_container_name_enabled: false,
    is_auto_deploy_enabled: true,
    is_image_auto_update_enabled: false,
    is_git_submodules_enabled: false,
    is_git_lfs_enabled: false,
    is_git_shallow_clone_enabled: false,
    is_pr_deployments_public_enabled: false,
    is_force_https_enabled: false,
    is_gzip_enabled: true,
    is_stripprefix_enabled: true,
    has_own_user_system: null,
    is_sso_protected: null,
    sso_protection_active: false,
    sso_available: true,
    sso_protect_apps_by_default: false,
    pocket_id_url: 'https://id.exemple.com',
    apps_wildcard_domain: 'https://exemple.com',
    is_log_drain_enabled: false,
    connect_to_docker_network: false,
    stop_grace_period: 30,
    max_restart_count: 10,
    capabilities: {
        git_based: true,
        dockercompose: false,
        dockerimage: false,
        log_drain_server: false,
    },
};

const settingsPayload = {
    instance: {
        fqdn: 'https://forge.exemple.com',
        apps_wildcard_domain: 'https://exemple.com',
    },
    sso: {
        sso_protect_apps_by_default: false,
        apps_protection_configured: true,
        apps_oidc_configured: true,
        pocket_id_url: 'https://id.exemple.com',
        oauth2_proxy_url: 'https://sso.exemple.com',
        can_start: true,
        managed_by_devforge: true,
    },
};

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('ApplicationAccessPanel', () => {
    it('permet d’activer Pocket ID comme barrière pour une app sans comptes', async () => {
        const putBodies: unknown[] = [];
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
            const url = String(input);
            if (url === '/sanctum/csrf-cookie') {
                return new Response(null, { status: 204 });
            }
            if (url.includes('/advanced') && init?.method === 'PUT') {
                putBodies.push(JSON.parse(String(init.body)));
                return jsonResponse({
                    data: {
                        ...advancedPayload,
                        has_own_user_system: false,
                        is_sso_protected: true,
                        sso_protection_active: true,
                        message: 'Accès Pocket ID mis à jour.',
                    },
                    meta: { redeploy: { queued: true, deployment_uuid: 'dep-1', message: 'queued' } },
                });
            }
            if (url.includes('/advanced')) {
                return jsonResponse({ data: advancedPayload });
            }
            if (url.includes('/api/devforge/v1/settings')) {
                return jsonResponse({ data: settingsPayload });
            }

            throw new Error(`URL inattendue : ${url}`);
        });

        const onRedeployQueued = vi.fn();
        render(<ApplicationAccessPanel applicationUuid="app-1" canAct onRedeployQueued={onRedeployQueued} />);

        expect(await screen.findByText('Accès Pocket ID')).toBeInTheDocument();
        expect(await screen.findByRole('radio', { name: 'Oui, elle a ses propres comptes' })).toBeInTheDocument();
        expect(screen.queryByRole('checkbox', { name: 'Protéger l’accès au site avec Pocket ID' })).not.toBeInTheDocument();

        fireEvent.click(screen.getByText('Non, pas de login dans l’app'));
        expect(await screen.findByRole('checkbox', { name: 'Protéger l’accès au site avec Pocket ID' })).toBeInTheDocument();

        fireEvent.click(screen.getByRole('checkbox', { name: 'Protéger l’accès au site avec Pocket ID' }));
        fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));

        await waitFor(() => {
            expect(putBodies).toEqual([{
                has_own_user_system: false,
                is_sso_protected: true,
                redeploy: true,
            }]);
        });
        expect(onRedeployQueued).toHaveBeenCalledWith('dep-1');
        expect(await screen.findByText(/Redéploiement lancé/)).toBeInTheDocument();
    });

    it('n’active pas la barrière quand l’app a déjà un système d’utilisateurs', async () => {
        const putBodies: unknown[] = [];
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
            const url = String(input);
            if (url === '/sanctum/csrf-cookie') {
                return new Response(null, { status: 204 });
            }
            if (url.includes('/advanced') && init?.method === 'PUT') {
                putBodies.push(JSON.parse(String(init.body)));
                return jsonResponse({
                    data: {
                        ...advancedPayload,
                        has_own_user_system: true,
                        is_sso_protected: false,
                        message: 'Accès Pocket ID mis à jour.',
                    },
                    meta: { redeploy: null },
                });
            }
            if (url.includes('/advanced')) {
                return jsonResponse({ data: advancedPayload });
            }
            if (url.includes('/api/devforge/v1/settings')) {
                return jsonResponse({ data: settingsPayload });
            }

            throw new Error(`URL inattendue : ${url}`);
        });

        render(<ApplicationAccessPanel applicationUuid="app-1" canAct />);

        fireEvent.click(await screen.findByText('Oui, elle a ses propres comptes'));
        expect(screen.queryByRole('checkbox', { name: 'Protéger l’accès au site avec Pocket ID' })).not.toBeInTheDocument();
        expect(await screen.findByText('SSO dans tes apps')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));

        await waitFor(() => {
            expect(putBodies).toEqual([{
                has_own_user_system: true,
                is_sso_protected: false,
                redeploy: false,
            }]);
        });
    });
});
