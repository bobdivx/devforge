import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { ApplicationWorkspaceDock } from '../src/components/ApplicationWorkspaceDock';

afterEach(() => {
    cleanup();
    window.history.replaceState({}, '', '/');
    window.localStorage.removeItem('df-spotlight');
});

describe('ApplicationWorkspaceDock', () => {
    it('mappe le dock vers les onglets existants', () => {
        window.history.replaceState({}, '', '/devforge/applications/app-1/?tab=logs');
        render(<ApplicationWorkspaceDock onNavigate={() => undefined} />);

        expect(screen.getByRole('navigation', { name: 'Espace de travail application' })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Chat' })).toHaveAttribute('href', '/devforge/applications/app-1/?tab=agents');
        expect(screen.getByRole('link', { name: 'Déploiements' })).toHaveAttribute('href', '/devforge/applications/app-1/?tab=deployments');
        expect(screen.getByRole('link', { name: 'Logs' })).toHaveAttribute('href', '/devforge/applications/app-1/?tab=logs');
        expect(screen.getByRole('link', { name: 'Env' })).toHaveAttribute('href', '/devforge/applications/app-1/?tab=variables');
        expect(screen.getByRole('link', { name: 'Réglages' })).toHaveAttribute('href', '/devforge/applications/app-1/?tab=settings');
        expect(screen.getByRole('link', { name: 'Logs' })).toHaveAttribute('aria-current', 'page');
        expect(screen.getByRole('button', { name: 'Désactiver Spotlight' })).toHaveAttribute('aria-pressed', 'true');
    });

    it('active Chat par défaut sans paramètre tab', () => {
        window.history.replaceState({}, '', '/devforge/applications/app-1/');
        render(<ApplicationWorkspaceDock onNavigate={() => undefined} />);

        expect(screen.getByRole('link', { name: 'Chat' })).toHaveAttribute('aria-current', 'page');
    });

    it('persiste le toggle Spotlight', () => {
        window.history.replaceState({}, '', '/devforge/applications/app-1/?tab=agents');
        render(<ApplicationWorkspaceDock onNavigate={() => undefined} />);

        const toggle = screen.getByRole('button', { name: 'Désactiver Spotlight' });
        fireEvent.click(toggle);
        expect(window.localStorage.getItem('df-spotlight')).toBe('0');
        expect(screen.getByRole('button', { name: 'Activer Spotlight' })).toHaveAttribute('aria-pressed', 'false');
    });
});
