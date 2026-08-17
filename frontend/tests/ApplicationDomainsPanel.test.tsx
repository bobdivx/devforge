import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApplicationDomainsPanel } from '../src/components/applications/ApplicationDomainsPanel';

function jsonResponse(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}

const managedDomain = 'https://app-uuid-1234.apps.example.com';

const domainsFixture = {
    domains: [managedDomain, 'https://demo.apps.example.com'],
    managed_domain: managedDomain,
    fqdn: `${managedDomain},https://demo.apps.example.com`,
    redirect: 'both',
    wildcard_domain: 'https://apps.example.com',
    build_pack: 'nixpacks',
    sslip_warning: false,
};

afterEach(() => {
    cleanup();
});

describe('ApplicationDomainsPanel', () => {
    it('affiche une ligne par domaine et enregistre la liste', async () => {
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
                        domains: [managedDomain, 'https://demo.apps.example.com'],
                        fqdn: `${managedDomain},https://demo.apps.example.com`,
                    },
                });
            }

            if (url.includes('/domains') && method === 'PUT') {
                const body = JSON.parse(String(init?.body ?? '{}')) as { domains?: string };

                return jsonResponse({
                    data: {
                        ...domainsFixture,
                        domains: (body.domains ?? '')
                            .split(',')
                            .map((item) => item.trim())
                            .filter(Boolean),
                        fqdn: body.domains ?? domainsFixture.fqdn,
                    },
                    meta: {
                        redeploy: {
                            queued: true,
                            deployment_uuid: 'deploy-domains-123',
                            message: 'Deployment queued.',
                        },
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
        expect(await screen.findByLabelText('Domaine DevForge')).toBeInTheDocument();
        expect(await screen.findByLabelText(/Domaine personnalisé/)).toBeInTheDocument();
        expect(screen.getByText('Protégé')).toBeInTheDocument();
        expect(screen.getByLabelText('Domaine DevForge')).toBeDisabled();

        fireEvent.input(screen.getByLabelText(/Domaine personnalisé/), {
            target: { value: 'https://custom.apps.example.com' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));

        await waitFor(() => {
            expect(screen.getByText(/Domaines enregistrés\./)).toBeInTheDocument();
            expect(screen.getByText(/Redéploiement lancé/)).toBeInTheDocument();
        });

        const putCall = fetchMock.mock.calls.find((call) => {
            const url = String(call[0]);
            const init = call[1] as RequestInit | undefined;

            return url.includes('/applications/app-uuid-1234/domains') && init?.method === 'PUT';
        });

        expect(putCall).toBeTruthy();
        expect(JSON.parse(String((putCall?.[1] as RequestInit).body))).toMatchObject({
            domains: `${managedDomain}, https://custom.apps.example.com`,
        });
    });

    it('préfixe https avant d’enregistrer un domaine sans schéma', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
            const url = String(input);
            const method = init?.method ?? 'GET';

            if (url.includes('/sanctum/csrf-cookie')) {
                return new Response(null, { status: 204 });
            }

            if (url.includes('/domains') && method === 'PUT') {
                return jsonResponse({
                    data: {
                        ...domainsFixture,
                        domains: [managedDomain, 'https://sonozz.briseteia.me'],
                        fqdn: `${managedDomain},https://sonozz.briseteia.me`,
                    },
                    meta: { redeploy: { queued: false, deployment_uuid: null, message: 'skipped' } },
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

        fireEvent.input(await screen.findByLabelText(/Domaine personnalisé/), {
            target: { value: 'sonozz.briseteia.me' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));

        await waitFor(() => {
            expect(screen.getByText(/Domaines enregistrés\./)).toBeInTheDocument();
        });

        const putCall = fetchMock.mock.calls.find((call) => {
            const url = String(call[0]);
            const init = call[1] as RequestInit | undefined;

            return url.includes('/applications/app-uuid-1234/domains') && init?.method === 'PUT';
        });

        expect(JSON.parse(String((putCall?.[1] as RequestInit).body))).toMatchObject({
            domains: `${managedDomain}, https://sonozz.briseteia.me`,
        });
    });

    it('ajoute un domaine personnalisé sans toucher au domaine DevForge', async () => {
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
            const url = String(input);

            if (url.includes('/sanctum/csrf-cookie')) {
                return new Response(null, { status: 204 });
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

        expect(await screen.findByLabelText('Domaine DevForge')).toBeInTheDocument();

        fireEvent.click(await screen.findByRole('button', { name: 'Ajouter' }));

        await waitFor(() => {
            expect(screen.getAllByPlaceholderText('https://mon-app.example.com')).toHaveLength(3);
        });
        expect(screen.getByLabelText('Domaine DevForge')).toBeDisabled();
    });
});
