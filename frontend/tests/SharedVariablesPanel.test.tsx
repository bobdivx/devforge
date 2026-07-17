import { cleanup, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SharedVariablesPanel } from '../src/components/shared-variables/SharedVariablesPanel';
import type { SharedVariables } from '../src/lib/domain-api';

function jsonResponse(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}

const variablesFixture: SharedVariables = {
    team: [{
        id: 1,
        key: 'API_TOKEN',
        scope: 'team',
        project_id: null,
        environment_id: null,
        server_id: null,
        comment: 'Jeton partagé',
        is_multiline: false,
        is_literal: true,
        is_shown_once: false,
        value: '********',
        value_locked: false,
    }],
    project: [],
    environment: [],
    server: [],
};

afterEach(cleanup);

describe('SharedVariablesPanel', () => {
    it('affiche les variables de l’équipe sur l’onglet dédié', async () => {
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
            const url = String(input);
            if (url === '/api/devforge/v1/shared-variables') {
                return jsonResponse({ data: variablesFixture });
            }
            throw new Error(`URL inattendue : ${url}`);
        });

        render(<SharedVariablesPanel path="/shared-variables/team" canManage />);

        expect(await screen.findByText('API_TOKEN')).toBeInTheDocument();
        expect(screen.getByText('Jeton partagé')).toBeInTheDocument();
        expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('Équipe');
        expect(screen.getByRole('button', { name: /Nouvelle variable/i })).toBeInTheDocument();
    });

    it('affiche les cartes de portée sur la vue d’ensemble', async () => {
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
            const url = String(input);
            if (url === '/api/devforge/v1/shared-variables') {
                return jsonResponse({ data: variablesFixture });
            }
            throw new Error(`URL inattendue : ${url}`);
        });

        render(<SharedVariablesPanel path="/shared-variables" />);

        expect(await screen.findByRole('button', { name: /Équipe/i })).toBeInTheDocument();
        expect(await screen.findByText('1')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Nouvelle variable/i })).not.toBeInTheDocument();
    });
});
