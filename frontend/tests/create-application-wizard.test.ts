import { describe, expect, it } from 'vitest';
import { normalizeApplicationUrl, resolveApplicationCustomDomain } from '../src/lib/create-application-wizard';

describe('create-application-wizard', () => {
    it('normalise l’URL perso d’une application', () => {
        expect(normalizeApplicationUrl('https://blog.maison.local/')).toBe('https://blog.maison.local');
        expect(normalizeApplicationUrl('blog.maison.local')).toBe('https://blog.maison.local');
        expect(normalizeApplicationUrl('')).toBe('');
    });

    it('n’envoie un domaine que si l’utilisateur en a choisi un', () => {
        expect(resolveApplicationCustomDomain('auto', 'https://blog.maison.local')).toBeUndefined();
        expect(resolveApplicationCustomDomain(null, 'https://blog.maison.local')).toBeUndefined();
        expect(resolveApplicationCustomDomain('custom', '')).toBeUndefined();
        expect(resolveApplicationCustomDomain('custom', 'blog.maison.local')).toBe('https://blog.maison.local');
    });
});
