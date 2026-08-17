import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InstanceSettingsPanels } from '../src/components/settings/InstanceSettingsPanels';
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

describe('InstanceSettingsPanels', () => {
    it('enregistre le domaine principal des applications', async () => {
        const update = vi.fn();
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
            const url = String(input);
            if (url === '/sanctum/csrf-cookie') {
                return new Response(null, { status: 204 });
            }
            if (url.includes('/settings/instance') && init?.method === 'PUT') {
                update(JSON.parse(String(init.body)));
                return jsonResponse({
                    data: {
                        instance: {
                            instance_name: 'DevForge',
                            fqdn: null,
                            apps_wildcard_domain: 'https://exemple.com',
                            instance_timezone: 'UTC',
                            public_ipv4: null,
                            public_ipv6: null,
                            public_port_min: 1025,
                            public_port_max: 65535,
                            helper_version: null,
                            dev_helper_version: null,
                            next_channel: null,
                        },
                    },
                });
            }
            if (url.includes('/api/devforge/v1/settings')) {
                return jsonResponse({
                    data: {
                        instance: {
                            instance_name: 'DevForge',
                            fqdn: null,
                            apps_wildcard_domain: 'https://exemple.com',
                            instance_timezone: 'UTC',
                            public_ipv4: null,
                            public_ipv6: null,
                            public_port_min: 1025,
                            public_port_max: 65535,
                            helper_version: null,
                            dev_helper_version: null,
                            next_channel: null,
                        },
                    },
                });
            }
            throw new Error(`URL inattendue : ${url}`);
        });

        render(<InstanceSettingsPanels
            section="instance"
            permissions={{ ...bootstrapData.permissions, instance_admin: true }}
            legacyBaseUrl=""
        />);

        expect(await screen.findByDisplayValue('exemple.com')).toBeInTheDocument();
        expect(screen.getByText((content) => content.includes('aperçu : https://starbasefr.exemple.com'))).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));

        await waitFor(() => {
            expect(update).toHaveBeenCalledWith(expect.objectContaining({
                apps_wildcard_domain: 'https://exemple.com',
                force_save_domains: true,
            }));
        });
    });

    it('propose de lancer la mise à jour d’instance quand une version est disponible', async () => {
        const start = vi.fn();
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
            const url = String(input);
            if (url === '/sanctum/csrf-cookie') {
                return new Response(null, { status: 204 });
            }
            if (url.includes('/settings/updates/upgrade') && init?.method === 'POST') {
                start();
                return jsonResponse({
                    data: {
                        available: true,
                        current_version: '4.0.0-beta.998',
                        latest_version: '4.0.0-beta.999',
                        status: 'in_progress',
                        step: 1,
                        message: 'Starting upgrade...',
                    },
                });
            }
            if (url.includes('/api/devforge/v1/settings')) {
                return jsonResponse({
                    data: {
                        updates: {
                            is_auto_update_enabled: false,
                            auto_update_frequency: '0 0 * * *',
                            update_check_frequency: '0 * * * *',
                            new_version_available: true,
                            current_version: '4.0.0-beta.998',
                            latest_version: '4.0.0-beta.999',
                        },
                    },
                });
            }
            throw new Error(`URL inattendue : ${url}`);
        });

        render(<InstanceSettingsPanels
            section="updates"
            permissions={{ ...bootstrapData.permissions, instance_admin: true }}
            legacyBaseUrl=""
        />);

        expect(await screen.findByText('Mise à jour disponible')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Mettre à jour maintenant' }));
        expect(await screen.findByText('Mettre à jour DevForge ?')).toBeInTheDocument();
        const confirmButtons = screen.getAllByRole('button', { name: 'Mettre à jour maintenant' });
        fireEvent.click(confirmButtons[confirmButtons.length - 1]);

        await waitFor(() => {
            expect(start).toHaveBeenCalledOnce();
        });
    });
});
