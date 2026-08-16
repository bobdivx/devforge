import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OnboardingDomainStep } from '../src/components/onboarding/OnboardingDomainStep';

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

describe('OnboardingDomainStep', () => {
    it('enregistre un domaine partagé pour toutes les applications', async () => {
        const update = vi.fn();
        const onSaved = vi.fn();
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
            const url = String(input);
            if (url === '/sanctum/csrf-cookie') {
                return new Response(null, { status: 204 });
            }
            if (url.includes('/settings/instance') && init?.method === 'PUT') {
                update(JSON.parse(String(init.body)));
                return jsonResponse({
                    data: {
                        instance: {
                            fqdn: window.location.origin,
                            apps_wildcard_domain: 'https://exemple.com',
                        },
                    },
                });
            }
            if (url.includes('/api/devforge/v1/settings') && !url.includes('/settings/')) {
                return jsonResponse({
                    data: {
                        instance: {
                            fqdn: null,
                            apps_wildcard_domain: null,
                            instance_name: 'DevForge',
                            instance_timezone: 'UTC',
                        },
                    },
                });
            }
            throw new Error(`URL inattendue : ${url}`);
        });

        render(<OnboardingDomainStep canEdit onBack={() => undefined} onSaved={onSaved} />);

        await waitFor(() => {
            expect(screen.getByRole('radio', { name: /Oui, j’ai un nom de domaine/ })).not.toBeDisabled();
        });
        fireEvent.click(screen.getByRole('radio', { name: /Oui, j’ai un nom de domaine/ }));
        fireEvent.input(screen.getByPlaceholderText('exemple.com'), {
            target: { value: 'exemple.com' },
        });
        expect(screen.getByText('https://starbasefr.exemple.com')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Continuer' }));

        await waitFor(() => {
            expect(update).toHaveBeenCalledWith({
                fqdn: window.location.origin,
                apps_wildcard_domain: 'https://exemple.com',
                force_save_domains: true,
            });
        });
        expect(onSaved).toHaveBeenCalled();
    });
});
