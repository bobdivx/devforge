import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/lib/api/client';
import { looksLikeExistingContainerError, looksLikeTimeoutError } from '../src/lib/runners/runner-create-errors';

describe('runner create errors', () => {
    it('détecte un conteneur déjà présent', () => {
        expect(looksLikeExistingContainerError(
            'Le conteneur github-runner-devforge-runner-popcorn-tauri existe déjà sur ce serveur.',
        )).toBe(true);
        expect(looksLikeExistingContainerError('Permission insuffisante')).toBe(false);
    });

    it('détecte un timeout proxy 504', () => {
        expect(looksLikeTimeoutError(new ApiError(504, { message: 'Gateway Timeout' }), 'Gateway Timeout')).toBe(true);
        expect(looksLikeTimeoutError(new Error('La requête API a échoué avec le statut 504'), 'La requête API a échoué avec le statut 504')).toBe(true);
        expect(looksLikeTimeoutError(new Error('boom'), 'Création impossible.')).toBe(false);
    });
});
