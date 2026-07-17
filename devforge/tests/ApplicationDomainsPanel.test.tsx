import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApplicationDomainsPanel } from '../src/components/applications/ApplicationDomainsPanel';

function jsonResponse(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}

const domainsFixture = {
    domains: ['https://demo.apps.example.com'],
    fqdn: 'https://demo.apps.example.com',
    redirect: 'both',
    wildcard_domain: 'https://apps.example.com',
    build_pack: 'nixpacks',
    sslip_warning: false,
};

afterEach(() => {
    cleanup();
});

describe('ApplicationDomainsPanel', () => {
    it('affiche et enregistre les domaines', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
            const url = String(input);
            const method = init?.method ?? 'GET';

            if (url.includes('/sanctum/csrf-cookie')) {
                return new Response(null, { status: 204 });
            }

            if (url.includes('/domains/generate')) {
                return jsonResponse({
                    data: {
                        ...domainsFixture,
                        domains: ['https://uuid.apps.example.com'],
                        fqdn: 'https://uuid.apps.example.com',
                    },
                });
            }

            if (url.includes('/domains') && method === 'PUT') {
                return jsonResponse({
                    data: {
                        ...domainsFixture,
                        domains: ['https://custom.apps.example.com'],
                        fqdn: 'https://custom.apps.example.com',
                    },
                });
            }

            if (url.includes('/domains')) {
                return jsonResponse({ data: domainsFixture });
            }

            throw new Error(`URL inattendue : ${url}`);
        });

        render(
            <ApplicationDomainsPanel
                applicationUuid="app-uuid-1234"
                canAct
            />,
        );

        expect(await screen.findByText('Domaines')).toBeInTheDocument();
        expect(await screen.findByText(/Wildcard serveur/)).toBeInTheDocument();
        expect(await screen.findByDisplayValue('https://demo.apps.example.com')).toBeInTheDocument();

        fireEvent.input(screen.getByPlaceholderText(/https:\/\/mon-app\.example\.com/), {
            target: { value: 'https://custom.apps.example.com' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));

        await waitFor(() => {
            expect(screen.getByText('Domaines enregistrés.')).toBeInTheDocument();
        });

        expect(fetchMock).toHaveBeenCalledWith(
            expect.stringContaining('/applications/app-uuid-1234/domains'),
            expect.objectContaining({ method: 'PUT' }),
        );
    });
});
