import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApplicationEnvironmentVariablesPanel } from '../src/components/applications/ApplicationEnvironmentVariablesPanel';

function jsonResponse(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}

const variablesFixture = {
    production: [{
        uuid: 'env-prod-1',
        key: 'APP_ENV',
        value: '********',
        has_value: true,
        comment: null,
        is_preview: false,
        is_runtime: true,
        is_buildtime: true,
        is_multiline: false,
        is_literal: false,
        is_shown_once: false,
        is_shared: false,
        is_coolify: false,
        is_buildpack_control: false,
        is_editable: true,
        is_deletable: true,
        is_revealable: true,
        updated_at: '2026-04-27T10:00:00.000Z',
    }, {
        uuid: 'env-prod-nix',
        key: 'NIXPACKS_NODE_VERSION',
        value: '********',
        has_value: true,
        comment: null,
        is_preview: false,
        is_runtime: false,
        is_buildtime: true,
        is_multiline: false,
        is_literal: false,
        is_shown_once: false,
        is_shared: false,
        is_coolify: false,
        is_buildpack_control: true,
        is_editable: false,
        is_deletable: true,
        is_revealable: true,
        updated_at: '2026-04-27T10:00:00.000Z',
    }],
    preview: [],
};

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('ApplicationEnvironmentVariablesPanel', () => {
    it('affiche les variables de production', async () => {
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
            const url = String(input);

            if (url.includes('/environment-variables') && url.includes('/reveal')) {
                return jsonResponse({ data: { uuid: 'env-prod-1', value: 'production' } });
            }

            if (url.includes('/environment-variables')) {
                return jsonResponse({ data: variablesFixture });
            }

            throw new Error(`URL inattendue : ${url}`);
        });

        render(
            <ApplicationEnvironmentVariablesPanel
                applicationUuid="app-uuid-1234"
                canAct
            />,
        );

        expect(await screen.findByText('Variables d’environnement')).toBeInTheDocument();
        expect(await screen.findByText('APP_ENV')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Ajouter' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Modifier APP_ENV' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Afficher APP_ENV' })).toBeInTheDocument();
        expect(screen.getByText('NIXPACKS_NODE_VERSION')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Supprimer NIXPACKS_NODE_VERSION' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Modifier NIXPACKS_NODE_VERSION' })).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Afficher APP_ENV' }));

        expect(await screen.findByText('production')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Masquer APP_ENV' })).toBeInTheDocument();
    });

    it('préremplit la valeur réelle dans le formulaire de modification', async () => {
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
            const url = String(input);

            if (url.includes('/environment-variables') && url.includes('/reveal')) {
                return jsonResponse({ data: { uuid: 'env-prod-1', value: 'production' } });
            }

            if (url.includes('/environment-variables')) {
                return jsonResponse({ data: variablesFixture });
            }

            throw new Error(`URL inattendue : ${url}`);
        });

        render(
            <ApplicationEnvironmentVariablesPanel
                applicationUuid="app-uuid-1234"
                canAct
            />,
        );

        expect(await screen.findByText('APP_ENV')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Modifier APP_ENV' }));

        expect(await screen.findByRole('heading', { name: 'Modifier APP_ENV' })).toBeInTheDocument();

        const valueField = await screen.findByDisplayValue('production');
        expect(valueField).toBeInTheDocument();
        expect(screen.queryByText(/laisser vide pour conserver/i)).not.toBeInTheDocument();
    });
});
