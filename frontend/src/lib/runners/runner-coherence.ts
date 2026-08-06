import type { CoreResource, GithubRunner } from '../domain-api';
import { parseApplicationConfiguration, repositoryLabel } from '../application-config';

export type LinkedApplication = {
    uuid: string;
    name: string;
    status: string;
    git_repository: string;
    git_branch: string | null;
    repo_key: string;
};

export type RunnerCoherence = 'linked' | 'orphan' | 'unsynced';

export type AppWithoutRunner = LinkedApplication;

/** Normalize any git URL / slug to lowercase `owner/repo`. */
export function normalizeRepoKey(value: string | null | undefined): string | null {
    if (!value) {
        return null;
    }

    const trimmed = value.trim();
    if (!trimmed) {
        return null;
    }

    const labeled = repositoryLabel(trimmed) ?? trimmed;
    const withoutHost = labeled
        .replace(/^github\.com\//i, '')
        .replace(/^www\.github\.com\//i, '');

    const match = withoutHost.match(/^([^/\s]+)\/([^/\s#?]+)/);
    if (!match) {
        return null;
    }

    const owner = match[1].toLowerCase();
    const repo = match[2].replace(/\.git$/i, '').toLowerCase();
    if (!owner || !repo) {
        return null;
    }

    return `${owner}/${repo}`;
}

export function runnerRepoKey(runner: GithubRunner): string | null {
    return normalizeRepoKey(runner.github_repo)
        ?? normalizeRepoKey(runner.repo_url);
}

export function applicationsWithGit(apps: CoreResource[]): LinkedApplication[] {
    return apps
        .filter((app) => app.type === 'application')
        .map((app) => {
            const config = parseApplicationConfiguration(app.configuration ?? {});
            const repoKey = normalizeRepoKey(config.git_repository);
            if (!repoKey || !config.git_repository) {
                return null;
            }

            return {
                uuid: app.uuid,
                name: app.name,
                status: typeof app.status === 'string' ? app.status : 'unknown',
                git_repository: config.git_repository,
                git_branch: config.git_branch,
                repo_key: repoKey,
            } satisfies LinkedApplication;
        })
        .filter((app): app is LinkedApplication => app !== null);
}

export function linkedAppsForRunner(
    runner: GithubRunner,
    apps: LinkedApplication[],
): LinkedApplication[] {
    const key = runnerRepoKey(runner);
    if (!key) {
        return [];
    }

    return apps.filter((app) => app.repo_key === key);
}

export function appsWithoutRunners(
    apps: LinkedApplication[],
    runners: GithubRunner[],
): AppWithoutRunner[] {
    const covered = new Set(
        runners
            .map((runner) => runnerRepoKey(runner))
            .filter((key): key is string => Boolean(key)),
    );

    return apps.filter((app) => !covered.has(app.repo_key));
}

export function runnerCoherence(
    runner: GithubRunner,
    linkedApps: LinkedApplication[],
): RunnerCoherence {
    if (linkedApps.length > 0) {
        return 'linked';
    }

    if (runnerRepoKey(runner)) {
        return 'orphan';
    }

    return 'unsynced';
}

export function coherenceLabel(coherence: RunnerCoherence): string {
    return ({
        linked: 'Lié à une app',
        orphan: 'Sans app DevForge',
        unsynced: 'Repo inconnu',
    })[coherence];
}

export function coherenceTone(coherence: RunnerCoherence): 'success' | 'warning' | 'neutral' | 'error' {
    return ({
        linked: 'success',
        orphan: 'warning',
        unsynced: 'neutral',
    })[coherence];
}

export function isRunnerRunning(state: string | null | undefined): boolean {
    const normalized = (state ?? '').toLowerCase();
    return normalized === 'running' || normalized.startsWith('up');
}

export function isRunnerStopped(state: string | null | undefined): boolean {
    const normalized = (state ?? '').toLowerCase();
    return normalized === 'exited'
        || normalized === 'dead'
        || normalized === 'created'
        || normalized === 'stopped'
        || normalized.startsWith('exited');
}

export function dockerActionAvailability(state: string | null | undefined): {
    canStart: boolean;
    canStop: boolean;
    canRestart: boolean;
} {
    const running = isRunnerRunning(state);
    const stopped = isRunnerStopped(state);
    const restarting = (state ?? '').toLowerCase() === 'restarting';

    return {
        canStart: !running && !restarting,
        canStop: running,
        canRestart: (running || stopped) && !restarting,
    };
}
