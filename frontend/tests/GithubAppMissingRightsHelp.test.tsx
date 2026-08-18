import { cleanup, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { GithubAppMissingRightsHelp } from '../src/components/github/GithubAppMissingRightsHelp';

describe('GithubAppMissingRightsHelp', () => {
    afterEach(() => {
        cleanup();
    });

    it('affiche les liens GitHub et les instructions', () => {
        render(
            <GithubAppMissingRightsHelp
                app={{
                    name: 'devforgezimaos',
                    permissions_url: 'https://github.com/settings/apps/devforgezimaos/permissions',
                    installation_settings_url: 'https://github.com/settings/installations/154217861',
                }}
            />,
        );

        expect(screen.getByText('Comment accorder les droits')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: /Ouvrir les permissions de l’app GitHub/ })).toHaveAttribute(
            'href',
            'https://github.com/settings/apps/devforgezimaos/permissions',
        );
        expect(screen.getByRole('link', { name: /Accepter les nouvelles permissions/ })).toHaveAttribute(
            'href',
            'https://github.com/settings/installations/154217861',
        );
        expect(screen.getByText(/Administration, Contents, Actions et Workflows/)).toBeInTheDocument();
    });
});
