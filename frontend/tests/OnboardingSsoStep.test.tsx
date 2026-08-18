import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OnboardingSsoStep } from '../src/components/onboarding/OnboardingSsoStep';

function jsonResponse(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('OnboardingSsoStep', () => {
    it('démarre Pocket ID via DevForge sans demander d’installer un service', async () => {
        const onSkip = vi.fn();
        const onContinue = vi.fn();
        const posts: string[] = [];
        const puts: string[] = [];

        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
            const url = String(input);
            if (url === '/sanctum/csrf-cookie') {
                return new Response(null, { status: 204 });
            }
            if (url.includes('/settings/sso/start') && init?.method === 'POST') {
                posts.push(url);
                return jsonResponse({ data: {} });
            }
            if (url.includes('/settings/sso') && init?.method === 'PUT') {
                puts.push(url);
                return jsonResponse({ data: {} });
            }
            if (url.includes('/api/devforge/v1/settings')) {
                return jsonResponse({
                    data: {
                        instance: {
                            fqdn: 'https://forge.exemple.com',
                            apps_wildcard_domain: 'https://exemple.com',
                        },
                        sso: {
                            sso_protect_apps_by_default: true,
                            sso_hide_local_login: false,
                            can_start: true,
                            pocket_id_url: 'https://id.exemple.com',
                            managed_by_devforge: true,
                        },
                    },
                });
            }
            throw new Error(`URL inattendue : ${url}`);
        });

        render(<OnboardingSsoStep canEdit onSkip={onSkip} onContinue={onContinue} onBack={() => undefined} />);

        expect(await screen.findByRole('heading', { name: 'SSO Pocket ID' })).toBeInTheDocument();
        expect(screen.getByText((content) => content.includes('DevForge démarre Pocket ID tout seul'))).toBeInTheDocument();
        expect(screen.queryByLabelText('Client ID')).not.toBeInTheDocument();
        expect(await screen.findByRole('link', { name: /Ouvrir Pocket ID/ })).toHaveAttribute('href', 'https://id.exemple.com');
        expect(screen.getByRole('link', { name: 'https://id.exemple.com/setup' })).toHaveAttribute(
            'href',
            'https://id.exemple.com/setup',
        );

        fireEvent.click(screen.getByRole('button', { name: 'Démarrer le SSO' }));

        await waitFor(() => {
            expect(onContinue).toHaveBeenCalled();
        });
        expect(puts.some((url) => url.includes('/settings/sso'))).toBe(true);
        expect(posts.some((url) => url.includes('/settings/sso/start'))).toBe(true);

        fireEvent.click(screen.getByRole('button', { name: 'Plus tard' }));
        expect(onSkip).toHaveBeenCalled();
    });
});
