import { describe, expect, it } from 'vitest';
import {
    applicationsWithGit,
    isRunnerVersionLogLine,
    linkedAppsForRunner,
    normalizeRepoKey,
    parseRunnerVersion,
    runnerCoherence,
    runnerRepoKey,
    runnerSupportsNode24,
    dockerActionAvailability,
} from '../src/lib/runners/runner-coherence';
import type { CoreResource, GithubRunner } from '../src/lib/domain-api';

function runner(partial: Partial<GithubRunner>): GithubRunner {
    return {
        id: 'srv:runner',
        name: 'github-runner-client',
        container_id: 'abc',
        image: 'runner:latest',
        state: 'running',
        status: 'Up',
        created: '',
        server_uuid: 'srv',
        server_name: 'localhost',
        repo_url: null,
        runner_name: 'runner',
        github_status: null,
        github_busy: null,
        github_runner_id: null,
        github_labels: [],
        github_repo: null,
        source: 'docker',
        linked_applications: [],
        ...partial,
    };
}

describe('runner-coherence', () => {
    it('normalise owner/repo depuis une URL github', () => {
        expect(normalizeRepoKey('https://github.com/bobdivx/popcorn-client')).toBe('bobdivx/popcorn-client');
        expect(normalizeRepoKey('bobdivx/popcorn-client.git')).toBe('bobdivx/popcorn-client');
    });

    it('préfère repo_url à un github_repo tronqué', () => {
        expect(runnerRepoKey(runner({
            github_repo: 'bobdivx/popcorn-clien',
            repo_url: 'https://github.com/bobdivx/popcorn-client',
        }))).toBe('bobdivx/popcorn-client');
    });

    it('lie un runner client à l’app popcornn-client', () => {
        const apps = applicationsWithGit([
            {
                uuid: 'app-1',
                type: 'application',
                name: 'popcornn-client',
                status: 'running',
                configuration: {
                    git_repository: 'https://github.com/bobdivx/popcorn-client',
                    git_branch: 'main',
                },
            } as unknown as CoreResource,
        ]);

        const linked = linkedAppsForRunner(runner({
            github_repo: 'bobdivx/popcorn-clien',
            repo_url: 'https://github.com/bobdivx/popcorn-client',
        }), apps);

        expect(linked).toHaveLength(1);
        expect(linked[0].name).toBe('popcornn-client');
        expect(runnerCoherence(runner({
            repo_url: 'https://github.com/bobdivx/popcorn-client',
            github_repo: 'bobdivx/popcorn-clien',
        }), linked)).toBe('linked');
    });

    it('accepte un lien manuel vers une app d’un autre dépôt', () => {
        const apps = applicationsWithGit([
            {
                uuid: 'app-1',
                type: 'application',
                name: 'popcornn-client',
                status: 'running',
                configuration: {
                    git_repository: 'https://github.com/bobdivx/popcorn-client',
                    git_branch: 'main',
                },
            } as unknown as CoreResource,
        ]);

        const linked = linkedAppsForRunner(runner({
            repo_url: 'https://github.com/bobdivx/popcorn-server',
            github_repo: 'bobdivx/popcorn-server',
            linked_applications: [{
                uuid: 'app-1',
                name: 'popcornn-client',
                role: 'backend',
                link_source: 'manual',
            }],
        }), apps);

        expect(linked).toHaveLength(1);
        expect(linked[0].link_source).toBe('manual');
        expect(linked[0].role).toBe('backend');
        expect(runnerCoherence(runner({
            repo_url: 'https://github.com/bobdivx/popcorn-server',
            linked_applications: linked.map((app) => ({
                uuid: app.uuid,
                name: app.name,
                role: app.role,
                link_source: 'manual',
            })),
        }), linked)).toBe('linked');
    });

    it('laisse orphan un runner sans app correspondante', () => {
        const apps = applicationsWithGit([
            {
                uuid: 'app-1',
                type: 'application',
                name: 'popcornn-client',
                status: 'running',
                configuration: {
                    git_repository: 'https://github.com/bobdivx/popcorn-client',
                    git_branch: 'main',
                },
            } as unknown as CoreResource,
        ]);

        const orphanRunner = runner({
            repo_url: 'https://github.com/bobdivx/popcorn-server',
            github_repo: 'bobdivx/popcorn-server',
        });
        const linked = linkedAppsForRunner(orphanRunner, apps);

        expect(linked).toHaveLength(0);
        expect(runnerCoherence(orphanRunner, linked)).toBe('orphan');
    });

    it('détecte une version runner trop ancienne pour Node 24', () => {
        expect(parseRunnerVersion('   Version: 2.321.0')).toBe('2.321.0');
        expect(parseRunnerVersion("Current runner version: '2.336.0'")).toBe('2.336.0');
        expect(runnerSupportsNode24('2.321.0')).toBe(false);
        expect(runnerSupportsNode24('2.327.1')).toBe(true);
        expect(runnerSupportsNode24('2.336.0')).toBe(true);
        expect(isRunnerVersionLogLine('Runner v2.336.0 pret')).toBe(true);
        expect(isRunnerVersionLogLine('Listening for Jobs')).toBe(false);
    });

    it('autorise la recréation même si le runner tourne déjà', () => {
        expect(dockerActionAvailability('running')).toMatchObject({
            canStart: false,
            canStop: true,
            canRestart: true,
            canRecreate: true,
        });
        expect(dockerActionAvailability('missing')).toMatchObject({
            canStart: false,
            canRecreate: true,
        });
    });
});
