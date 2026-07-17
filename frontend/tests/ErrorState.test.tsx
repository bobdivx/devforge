import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../src/lib/api-client';
import { ErrorState } from '../src/components/ui/ErrorState';

afterEach(cleanup);

describe('erreurs d’authentification DevForge', () => {
    it.each([
        [401, 'Session requise'],
        [403, 'Accès refusé'],
        [419, 'Session expirée'],
    ])('affiche un état explicite et permet de réessayer pour HTTP %s', (status, title) => {
        const onRetry = vi.fn();
        render(<ErrorState error={new ApiError(status, null)} onRetry={onRetry} />);

        expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
        expect(onRetry).toHaveBeenCalledOnce();

        if (status === 401 || status === 419) {
            expect(screen.getByRole('link', { name: 'Se connecter' })).toHaveAttribute(
                'href',
                '/login?redirect=/devforge/',
            );
        } else {
            expect(screen.queryByRole('link', { name: 'Se connecter' })).not.toBeInTheDocument();
        }
    });
});
