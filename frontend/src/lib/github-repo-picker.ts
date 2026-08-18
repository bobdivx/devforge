import type { GithubAppSummary, GithubRepository } from './api/domain';
import { isGithubAppInstalled } from './onboarding-github';

export type GithubOrganizationOption = {
    key: string;
    label: string;
    subtitle: string | null;
    avatarUrl: string | null;
    githubAppUuid: string;
    accountType: string | null;
};

export type PickedGithubRepository = GithubRepository & {
    github_app_uuid: string;
};

export function githubOrganizationLabel(app: GithubAppSummary): string {
    return app.account_login ?? app.organization ?? app.display_name ?? app.name;
}

export function githubOrganizationsFromApps(apps: GithubAppSummary[]): GithubOrganizationOption[] {
    return apps
        .filter(isGithubAppInstalled)
        .map((app) => ({
            key: app.uuid,
            label: githubOrganizationLabel(app),
            subtitle: app.account_type === 'Organization'
                ? 'Organisation'
                : app.account_type === 'User'
                    ? 'Compte personnel'
                    : null,
            avatarUrl: app.account_avatar_url ?? null,
            githubAppUuid: app.uuid,
            accountType: app.account_type ?? null,
        }))
        .sort((left, right) => left.label.localeCompare(right.label, 'fr', { sensitivity: 'base' }));
}

export function filterGithubOrganizations(
    organizations: GithubOrganizationOption[],
    query: string,
): GithubOrganizationOption[] {
    const normalized = query.trim().toLowerCase();
    if (normalized === '') {
        return organizations;
    }

    return organizations.filter((organization) => organization.label.toLowerCase().includes(normalized)
        || (organization.subtitle ?? '').toLowerCase().includes(normalized));
}

export function attachGithubAppUuid(
    repositories: GithubRepository[],
    githubAppUuid: string,
): PickedGithubRepository[] {
    return repositories.map((repository) => ({
        ...repository,
        github_app_uuid: githubAppUuid,
    }));
}

export function togglePickedRepository(
    selected: PickedGithubRepository[],
    repository: PickedGithubRepository,
    mode: 'single' | 'multiple',
): PickedGithubRepository[] {
    if (mode === 'single') {
        return selected[0]?.id === repository.id ? selected : [repository];
    }

    return selected.some((item) => item.id === repository.id)
        ? selected.filter((item) => item.id !== repository.id)
        : [...selected, repository];
}

export function setVisibleSelection(
    selected: PickedGithubRepository[],
    visible: PickedGithubRepository[],
    selectAll: boolean,
): PickedGithubRepository[] {
    const visibleIds = new Set(visible.map((repository) => repository.id));
    const kept = selected.filter((repository) => !visibleIds.has(repository.id));

    return selectAll ? [...kept, ...visible] : kept;
}

export function areAllVisibleSelected(
    selected: PickedGithubRepository[],
    visible: PickedGithubRepository[],
): boolean {
    if (visible.length === 0) {
        return false;
    }

    const selectedIds = new Set(selected.map((repository) => repository.id));

    return visible.every((repository) => selectedIds.has(repository.id));
}

export function githubHtmlOrigin(htmlUrl: string | null | undefined): string {
    if (!htmlUrl) {
        return 'https://github.com';
    }

    try {
        return new URL(htmlUrl).origin;
    } catch {
        return 'https://github.com';
    }
}

export function githubInstallationSettingsUrl(app: GithubAppSummary): string | null {
    if (app.installation_id === null || app.installation_id === undefined || `${app.installation_id}` === '') {
        return null;
    }

    const origin = githubHtmlOrigin(app.html_url);
    if (app.account_type === 'Organization' && app.account_login) {
        return `${origin}/organizations/${encodeURIComponent(app.account_login)}/settings/installations/${app.installation_id}`;
    }

    return `${origin}/settings/installations/${app.installation_id}`;
}

export function findOrganizationByOwner(
    organizations: GithubOrganizationOption[],
    owner: string | null | undefined,
): GithubOrganizationOption | null {
    const normalized = owner?.trim().toLowerCase() ?? '';
    if (normalized === '') {
        return null;
    }

    return organizations.find((organization) => organization.label.toLowerCase() === normalized) ?? null;
}
