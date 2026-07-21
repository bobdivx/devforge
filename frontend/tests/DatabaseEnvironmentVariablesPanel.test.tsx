import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseEnvironmentVariablesPanel } from '../src/components/databases/DatabaseEnvironmentVariablesPanel';

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

describe('DatabaseEnvironmentVariablesPanel', () => {
    it('affiche les variables et permet de révéler une valeur', async () => {
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
            const url = String(input);

            if (url.includes('/environment-variables') && url.includes('/reveal')) {
                return jsonResponse({ data: { uuid: 'env-1', value: 'secret-db' } });
            }

            if (url.includes('/environment-variables')) {
                return jsonResponse({
                    data: [{
                        uuid: 'env-1',
                        key: 'POSTGRES_DB',
                        value: '********',
                        has_value: true,
                        comment: null,
                        is_preview: false,
                        is_runtime: true,
                        is_buildtime: false,
                        is_multiline: false,
                        is_literal: false,
                        is_shown_once: false,
                        is_shared: false,
                        is_coolify: false,
                        is_buildpack_control: false,
                        is_editable: true,
                        is_revealable: true,
                        updated_at: '2026-04-27T10:00:00.000Z',
                    }],
                });
            }

            throw new Error(`URL inattendue : ${url}`);
        });

        render(<DatabaseEnvironmentVariablesPanel databaseUuid="db-uuid-1" canAct />);

        expect(await screen.findByText('Variables d’environnement')).toBeInTheDocument();
        expect(await screen.findByText('POSTGRES_DB')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Ajouter' })).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Afficher POSTGRES_DB' }));

        expect(await screen.findByText('secret-db')).toBeInTheDocument();
    });
});
