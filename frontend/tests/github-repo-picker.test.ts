import { describe, expect, it } from 'vitest';
import type { GithubAppSummary, GithubRepository } from '../src/lib/api/domain';
import {
    areAllVisibleSelected,
    attachGithubAppUuid,
    filterGithubOrganizations,
    findOrganizationByOwner,
    githubInstallationSettingsUrl,
    githubOrganizationsFromApps,
    setVisibleSelection,
    togglePickedRepository,
} from '../src/lib/github-repo-picker';

const app = (overrides: Partial<GithubAppSummary> = {}): GithubAppSummary => ({
    uuid: 'app-1',
    name: 'DevForge',
    organization: null,
    html_url: 'https://github.com',
    is_system_wide: false,
    installation_id: 99,
    ...overrides,
});

const repo = (overrides: Partial<GithubRepository> = {}): GithubRepository => ({
    id: 1,
    name: 'popcorn',
    full_name: 'bobdivx/popcorn',
    owner: 'bobdivx',
    private: true,
    html_url: 'https://github.com/bobdivx/popcorn',
    default_branch: 'main',
    description: null,
    ...overrides,
});

describe('github-repo-picker', () => {
    it('construit les organisations à partir des GitHub Apps installées', () => {
        const organizations = githubOrganizationsFromApps([
            app({
                uuid: 'org-2',
                account_login: 'Briseteia',
                account_type: 'Organization',
                installation_id: 2,
            }),
            app({
                uuid: 'org-1',
                account_login: 'bobdivx',
                account_type: 'User',
                installation_id: 1,
            }),
            app({ uuid: 'draft', installation_id: null }),
        ]);

        expect(organizations.map((item) => item.label)).toEqual(['bobdivx', 'Briseteia']);
        expect(organizations[0]?.subtitle).toBe('Compte personnel');
        expect(organizations[1]?.subtitle).toBe('Organisation');
    });

    it('filtre les organisations par nom', () => {
        const organizations = githubOrganizationsFromApps([
            app({ uuid: 'a', account_login: 'bobdivx', installation_id: 1 }),
            app({ uuid: 'b', account_login: 'Briseteia', installation_id: 2 }),
        ]);

        expect(filterGithubOrganizations(organizations, 'bri').map((item) => item.label)).toEqual(['Briseteia']);
        expect(findOrganizationByOwner(organizations, 'bobdivx')?.key).toBe('a');
    });

    it('bascule la sélection simple ou multiple', () => {
        const popcorn = { ...repo({ id: 1 }), github_app_uuid: 'app-1' };
        const blog = { ...repo({ id: 2, name: 'blog' }), github_app_uuid: 'app-1' };

        expect(togglePickedRepository([], popcorn, 'single')).toEqual([popcorn]);
        expect(togglePickedRepository([popcorn], blog, 'single')).toEqual([blog]);
        expect(togglePickedRepository([popcorn], popcorn, 'multiple')).toEqual([]);
        expect(togglePickedRepository([popcorn], blog, 'multiple')).toEqual([popcorn, blog]);
    });

    it('sélectionne ou désélectionne uniquement les dépôts visibles', () => {
        const visible = attachGithubAppUuid([
            repo({ id: 1, name: 'blog' }),
            repo({ id: 2, name: 'api' }),
        ], 'app-1');
        const other = { ...repo({ id: 9, name: 'other' }), github_app_uuid: 'app-2' };

        const all = setVisibleSelection([other], visible, true);
        expect(all.map((item) => item.id)).toEqual([9, 1, 2]);
        expect(areAllVisibleSelected(all, visible)).toBe(true);

        const none = setVisibleSelection(all, visible, false);
        expect(none.map((item) => item.id)).toEqual([9]);
        expect(areAllVisibleSelected(none, visible)).toBe(false);
    });

    it('construit l’URL GitHub pour ajouter des dépôts à l’installation', () => {
        expect(githubInstallationSettingsUrl(app({
            installation_id: 111,
            account_type: 'User',
            account_login: 'bobdivx',
        }))).toBe('https://github.com/settings/installations/111');

        expect(githubInstallationSettingsUrl(app({
            installation_id: 222,
            account_type: 'Organization',
            account_login: 'Briseteia',
        }))).toBe('https://github.com/organizations/Briseteia/settings/installations/222');

        expect(githubInstallationSettingsUrl(app({ installation_id: null }))).toBeNull();
    });
});
