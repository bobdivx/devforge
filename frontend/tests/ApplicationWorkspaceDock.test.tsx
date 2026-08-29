import { cleanup, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { ApplicationWorkspaceDock } from '../src/components/ApplicationWorkspaceDock';

afterEach(() => {
    cleanup();
    window.history.replaceState({}, '', '/');
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
    });
});
