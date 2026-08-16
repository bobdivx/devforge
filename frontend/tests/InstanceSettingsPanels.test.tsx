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
});
