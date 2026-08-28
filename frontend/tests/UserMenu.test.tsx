import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UserMenu } from '../src/components/UserMenu';
import { bootstrapData } from './fixtures';

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('UserMenu', () => {
    it('ouvre Profil, À propos et Déconnexion au clic sur l’avatar', () => {
        render(<UserMenu user={bootstrapData.user} teamName={bootstrapData.current_team.name} />);

        expect(screen.queryByRole('menuitem', { name: 'Profil' })).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /Menu du compte/ }));

        expect(screen.getByRole('menuitem', { name: 'Profil' })).toHaveAttribute('href', '/devforge/settings/');
        expect(screen.getByRole('menuitem', { name: 'À propos' })).toHaveAttribute('href', '/devforge/a-propos/');
        expect(screen.getByRole('menuitem', { name: 'Déconnexion' })).toBeInTheDocument();
    });

    it('ferme le menu au clic en dehors', () => {
        render(<UserMenu user={bootstrapData.user} teamName={bootstrapData.current_team.name} />);
        fireEvent.click(screen.getByRole('button', { name: /Menu du compte/ }));
        expect(screen.getByRole('menuitem', { name: 'Profil' })).toBeInTheDocument();

        fireEvent.pointerDown(document.body);

        expect(screen.queryByRole('menuitem', { name: 'Profil' })).not.toBeInTheDocument();
    });

    it('poste Fortify /logout puis redirige vers /login', async () => {
        const assign = vi.fn();
        vi.stubGlobal('location', { ...window.location, assign });
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
            const url = String(input);
            if (url === '/sanctum/csrf-cookie') {
                return new Response(null, { status: 204 });
            }
            if (url === '/logout') {
                return new Response(null, { status: 204 });
            }
            throw new Error(`URL inattendue : ${url}`);
        });

        render(<UserMenu user={bootstrapData.user} teamName={bootstrapData.current_team.name} />);
        fireEvent.click(screen.getByRole('button', { name: /Menu du compte/ }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Déconnexion' }));

        await waitFor(() => {
            expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual(
                expect.arrayContaining(['/sanctum/csrf-cookie', '/logout']),
            );
        });
        await waitFor(() => expect(assign).toHaveBeenCalledWith('/login'));
    });
});
