import { describe, expect, it } from 'vitest';
import type { DeploymentTarget, GithubAppSummary, GithubRepository, Project } from '../src/lib/api/domain';
import {
    filterGithubRepositories,
    firstDestinationUuid,
    firstProjectEnvironment,
    isGithubAppInstalled,
    toggleSelectedId,
} from '../src/lib/onboarding-github';

const app = (installationId: string | number | null): GithubAppSummary => ({
    uuid: 'app-1',
    name: 'DevForge',
    organization: null,
    html_url: 'https://github.com',
    is_system_wide: false,
    installation_id: installationId,
});

describe('onboarding-github', () => {
    it('détecte une GitHub App installée', () => {
        expect(isGithubAppInstalled(app(12))).toBe(true);
        expect(isGithubAppInstalled(app(null))).toBe(false);
        expect(isGithubAppInstalled(app(''))).toBe(false);
    });

    it('filtre et bascule la sélection de dépôts', () => {
        const repositories: GithubRepository[] = [
            {
                id: 1,
                name: 'popcorn',
                full_name: 'bob/popcorn',
                owner: 'bob',
                private: true,
                html_url: 'https://github.com/bob/popcorn',
                default_branch: 'main',
                description: 'Client',
            },
            {
                id: 2,
                name: 'devforge',
                full_name: 'bob/devforge',
                owner: 'bob',
                private: false,
                html_url: 'https://github.com/bob/devforge',
                default_branch: 'main',
                description: null,
            },
        ];

        expect(filterGithubRepositories(repositories, 'pop').map((item) => item.id)).toEqual([1]);
        expect(toggleSelectedId([1], 2)).toEqual([1, 2]);
        expect(toggleSelectedId([1, 2], 1)).toEqual([2]);
    });

    it('prend le premier projet, environnement et destination', () => {
        const projects: Project[] = [{
            id: 1,
            uuid: 'proj-1',
            name: 'App',
            description: null,
            created_at: '',
            updated_at: '',
            environments: [{
                id: 2,
                uuid: 'env-1',
                project_id: 1,
                name: 'production',
                description: null,
                created_at: '',
                updated_at: '',
            }],
        }];
        const targets: DeploymentTarget[] = [{
            uuid: 'srv-1',
            name: 'localhost',
            reachable: true,
            usable: true,
            destinations: [{ uuid: 'dest-1', name: 'docker', type: 'standalone' }],
        }];

        expect(firstProjectEnvironment(projects)).toEqual({
            projectUuid: 'proj-1',
            environmentUuid: 'env-1',
        });
        expect(firstDestinationUuid(targets)).toBe('dest-1');
        expect(firstProjectEnvironment([])).toBeNull();
        expect(firstDestinationUuid([])).toBeNull();
    });
});
