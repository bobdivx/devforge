import { describe, expect, it } from 'vitest';
import { legacyCoolifyUrl } from '../src/lib/migration';

describe('legacyCoolifyUrl', () => {
    it('ajoute legacy=1 à la racine de l’instance', () => {
        expect(legacyCoolifyUrl('http://localhost')).toBe('http://localhost/?legacy=1');
    });

    it('construit une URL relative sans base', () => {
        expect(legacyCoolifyUrl('', '/sources')).toBe('/sources?legacy=1');
    });

    it('préserve un chemin personnalisé', () => {
        expect(legacyCoolifyUrl('https://coolify.example.com', '/projects')).toBe(
            'https://coolify.example.com/projects?legacy=1',
        );
    });
});
