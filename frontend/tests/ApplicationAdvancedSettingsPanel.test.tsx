import { cleanup, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApplicationAdvancedSettingsPanel } from '../src/components/applications/ApplicationAdvancedSettingsPanel';

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

describe('ApplicationAdvancedSettingsPanel', () => {
    it('affiche les paramètres avancés', async () => {
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
            const url = String(input);
            if (url.includes('/advanced')) {
                return jsonResponse({
                    data: {
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
                        is_log_drain_enabled: false,
                        connect_to_docker_network: false,
                        stop_grace_period: 30,
                        max_restart_count: 10,
                        capabilities: {
                            git_based: true,
                            dockercompose: false,
                            dockerimage: true,
                            log_drain_server: false,
                        },
                    },
                });
            }

            return jsonResponse({ message: 'not found' }, 404);
        });

        render(<ApplicationAdvancedSettingsPanel applicationUuid="app-1" canAct />);

        await waitFor(() => {
            expect(screen.getByText('Paramètres avancés')).toBeTruthy();
            expect(screen.getByText('Désactiver le cache de build')).toBeTruthy();
            expect(screen.getByText('Ne pas télécharger Chrome (Puppeteer)')).toBeTruthy();
            expect(screen.getByText('Auto-update image Docker Hub')).toBeTruthy();
            expect(screen.getByDisplayValue('30')).toBeTruthy();
            expect(screen.getByDisplayValue('10')).toBeTruthy();
        });
    });
});

