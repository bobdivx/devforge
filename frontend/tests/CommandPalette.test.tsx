import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommandPalette } from '../src/components/CommandPalette';
import { openCommandPalette } from '../src/lib/command-palette';

function jsonResponse(data: unknown): Response {
    return new Response(JSON.stringify(data), {
        status: 200,
        headers: { 'content-type': 'application/json' },
    });
}

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('CommandPalette', () => {
    it('s’ouvre avec ⌘K et liste les commandes en français', async () => {
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
            if (String(input) === '/api/devforge/v1/overview') {
                return jsonResponse({
                    data: {
                        resource_statuses: { applications: [], services: [], databases: [], servers: [] },
                        agent_activity: [],
                    },
                });
            }
            throw new Error(`URL inattendue : ${input}`);
        });

        render(<CommandPalette />);
        fireEvent.keyDown(window, { key: 'k', metaKey: true });

        expect(await screen.findByRole('dialog', { name: 'Palette de commandes' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Accueil/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Nouveau chat/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Réglages/i })).toBeInTheDocument();
    });

    it('s’ouvre via openCommandPalette', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
            data: { resource_statuses: { applications: [], services: [], databases: [], servers: [] }, agent_activity: [] },
        }));

        render(<CommandPalette />);
        openCommandPalette();

        expect(await screen.findByPlaceholderText('Rechercher une app, une commande…')).toBeInTheDocument();
    });
});
