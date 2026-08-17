import { describe, expect, it } from 'vitest';
import { resolveApplicationLogoUrl } from '../src/lib/application-logo';

describe('resolveApplicationLogoUrl', () => {
    it('utilise le favicon du premier domaine', () => {
        expect(resolveApplicationLogoUrl({
            domains: ['https://macompta.example.com', 'https://www.other.test'],
            git_repository: 'https://github.com/acme/macompta',
        })).toBe('https://www.google.com/s2/favicons?domain=macompta.example.com&sz=64');
    });

    it('accepte un domaine sans schéma', () => {
        expect(resolveApplicationLogoUrl({
            domains: ['popcorn-web.briseteia.me'],
        })).toBe('https://www.google.com/s2/favicons?domain=popcorn-web.briseteia.me&sz=64');
    });

    it('retombe sur l’avatar GitHub du owner si aucun domaine', () => {
        expect(resolveApplicationLogoUrl({
            domains: [],
            git_repository: 'https://github.com/briseteia/teslasphere',
        })).toBe('https://github.com/briseteia.png?size=64');
    });

    it('ignore les FQDN générés Coolify qui n’ont pas de favicon Google', () => {
        expect(resolveApplicationLogoUrl({
            domains: [
                'http://elhqi0vaqt1z9913zgv9h4zu.briseteia.me',
                'https://tesla.briseteia.me',
            ],
        })).toBe('https://www.google.com/s2/favicons?domain=tesla.briseteia.me&sz=64');
    });

    it('retombe sur GitHub si tous les domaines sont des FQDN générés', () => {
        expect(resolveApplicationLogoUrl({
            domains: ['http://cdnsf18lcgxwr3d3tmzhy50w.briseteia.me'],
            git_repository: 'https://github.com/briseteia/teslasphere',
        })).toBe('https://github.com/briseteia.png?size=64');
    });

    it('supporte les URLs git SSH GitHub', () => {
        expect(resolveApplicationLogoUrl({
            git_repository: 'git@github.com:briseteia/chistera.git',
        })).toBe('https://github.com/briseteia.png?size=64');
    });

    it('retourne null sans domaine ni dépôt GitHub', () => {
        expect(resolveApplicationLogoUrl({
            domains: [],
            git_repository: 'https://gitlab.com/acme/app',
        })).toBeNull();
        expect(resolveApplicationLogoUrl(null)).toBeNull();
    });
});
