import { describe, expect, it } from 'vitest';
import { laravelGithubAppCallbackPath } from '../src/lib/github-app-callback';

describe('callback GitHub App', () => {
    it('renvoie le retour manifest vers Laravel', () => {
        expect(laravelGithubAppCallbackPath(
            '/webhooks/source/github/redirect',
            '?code=abc&state=xyz',
        )).toBe('/login/github/manifest?code=abc&state=xyz');
    });

    it('renvoie le retour install vers Laravel', () => {
        expect(laravelGithubAppCallbackPath(
            '/webhooks/source/github/install',
            '?setup_action=install&installation_id=1',
        )).toBe('/login/github/setup?setup_action=install&installation_id=1');
    });

    it('ignore les autres routes', () => {
        expect(laravelGithubAppCallbackPath('/onboarding', '?pick=repos')).toBeNull();
        expect(laravelGithubAppCallbackPath('/webhooks/source/github/events')).toBeNull();
    });
});
