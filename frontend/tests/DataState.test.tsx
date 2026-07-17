import { render, screen } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import { DataState } from '../src/components/ui/DataState';
import { ApiError } from '../src/lib/api-client';

describe('DataState erreurs métier', () => {
    it('affiche le message API pour une ressource introuvable', () => {
        render(
            <DataState
                loading={false}
                error={new ApiError(404, { message: 'Resource not found.' })}
                onRetry={() => undefined}
            >
                contenu
            </DataState>,
        );

        expect(screen.getByText('Resource not found.')).toBeInTheDocument();
    });

    it('affiche un message dédié pour un conflit d’équipe', () => {
        render(
            <DataState
                loading={false}
                error={new ApiError(409, { message: 'Current team is unavailable.' })}
                onRetry={() => undefined}
            >
                contenu
            </DataState>,
        );

        expect(screen.getByText('Current team is unavailable.')).toBeInTheDocument();
    });
});
