import { describe, expect, it } from 'vitest';
import { DEFAULT_INSTANCE_SSO } from '../src/lib/api/domain';
import { ssoCursorPrompt, ssoIssuerUrl } from '../src/lib/sso-app-identity';

const sso = {
    ...DEFAULT_INSTANCE_SSO,
    pocket_id_url: 'https://id.exemple.com',
    oauth2_proxy_url: 'https://sso.exemple.com',
};

describe('sso-app-identity', () => {
    it('utilise l’issuer Pocket ID public', () => {
        expect(ssoIssuerUrl(sso)).toBe('https://id.exemple.com');
    });

    it('génère un prompt Cursor où le SSO est optionnel puis prioritaire par user', () => {
        const prompt = ssoCursorPrompt(sso);
        expect(prompt).toContain('https://id.exemple.com');
        expect(prompt).toContain('Continuer avec Pocket ID');
        expect(prompt).toContain('OPTIONNEL');
        expect(prompt).toContain('sso_linked_at');
        expect(prompt).toContain('OIDC_CLIENT_ID');
        expect(prompt).not.toContain('Ne PAS implémenter un flow OIDC');
    });
});
