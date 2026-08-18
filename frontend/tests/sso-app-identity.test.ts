import { describe, expect, it } from 'vitest';
import { DEFAULT_INSTANCE_SSO } from '../src/lib/api/domain';
import { ssoAppsOrigin, ssoCursorPrompt, ssoIssuerUrl } from '../src/lib/sso-app-identity';

const sso = {
    ...DEFAULT_INSTANCE_SSO,
    pocket_id_url: 'https://id.briseteia.me',
    oauth2_proxy_url: 'https://sso.briseteia.me',
};

describe('sso-app-identity', () => {
    it('expose l’issuer Pocket ID réel', () => {
        expect(ssoIssuerUrl(sso)).toBe('https://id.briseteia.me');
        expect(ssoAppsOrigin(sso, 'https://briseteia.me')).toBe('https://briseteia.me');
    });

    it('met les URLs de l’instance dans le prompt et laisse id/secret en variables d’env', () => {
        const prompt = ssoCursorPrompt(sso, { appsWildcardDomain: 'https://briseteia.me' });
        expect(prompt).toContain('Issuer Pocket ID : https://id.briseteia.me');
        expect(prompt).toContain('https://id.briseteia.me/.well-known/openid-configuration');
        expect(prompt).toContain('https://*.briseteia.me/**');
        expect(prompt).toContain('https://<ton-app>.briseteia.me/api/auth/callback/pocket-id');
        expect(prompt).toContain('OIDC_CLIENT_ID');
        expect(prompt).toContain('OIDC_CLIENT_SECRET');
        expect(prompt).toContain('ne hardcode pas l’issuer');
        expect(prompt).not.toContain('id.exemple.com');
        expect(prompt).not.toContain('mon-app.briseteia.me');
    });
});
