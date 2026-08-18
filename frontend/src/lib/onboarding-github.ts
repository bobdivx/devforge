import type { DeploymentTarget, GithubAppSummary, GithubRepository, Project } from './api/domain';

export function isGithubAppInstalled(app: GithubAppSummary): boolean {
    return app.installation_id !== null && app.installation_id !== undefined && `${app.installation_id}` !== '';
}

export function filterGithubRepositories<T extends GithubRepository>(repositories: T[], query: string): T[] {
    const normalized = query.trim().toLowerCase();
    if (normalized === '') {
        return repositories;
    }

    return repositories.filter((repository) => repository.full_name.toLowerCase().includes(normalized)
        || repository.name.toLowerCase().includes(normalized)
        || (repository.description ?? '').toLowerCase().includes(normalized));
}

export function toggleSelectedId(ids: number[], id: number): number[] {
    return ids.includes(id) ? ids.filter((current) => current !== id) : [...ids, id];
}

export function firstProjectEnvironment(projects: Project[]): { projectUuid: string; environmentUuid: string } | null {
    const project = projects[0];
    const environment = project?.environments?.[0];
    if (!project || !environment) {
        return null;
    }

    return {
        projectUuid: project.uuid,
        environmentUuid: environment.uuid,
    };
}

export function firstDestinationUuid(targets: DeploymentTarget[]): string | null {
    return targets[0]?.destinations[0]?.uuid ?? null;
}
