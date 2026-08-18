import { afterEach, describe, expect, it, vi } from 'vitest';
import { redirectToGithubAppSetup } from '../src/components/github/ConnectGithubButton';

function jsonResponse(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}

describe('redirectToGithubAppSetup', () => {
    const originalSubmit = HTMLFormElement.prototype.submit;

    afterEach(() => {
        vi.restoreAllMocks();
        HTMLFormElement.prototype.submit = originalSubmit;
    });

    it('demande les droits Administration lors de la création de l’app GitHub', async () => {
        HTMLFormElement.prototype.submit = vi.fn();
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
            const url = String(input);
            if (url === '/sanctum/csrf-cookie') {
                return new Response(null, { status: 204 });
            }
            if (url.endsWith('/github/apps')) {
                return jsonResponse({
                    data: {
                        launch: {
                            action_url: 'https://github.com/settings/apps/new?state=abc',
                            manifest: { name: 'DevForge' },
                        },
                    },
                }, 201);
            }
            throw new Error(`URL inattendue : ${url}`);
        });

        await redirectToGithubAppSetup({ fromOnboarding: true });

        const createCall = fetchMock.mock.calls.find(([input]) => String(input).endsWith('/github/apps'));
        expect(createCall).toBeDefined();
        expect(JSON.parse(String(createCall?.[1]?.body))).toMatchObject({
            name: 'DevForge',
            preview_deployments: true,
            administration: true,
            from_onboarding: true,
        });
    });
});
