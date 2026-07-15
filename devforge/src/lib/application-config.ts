import type { CoreResource, Deployment } from '../lib/domain-api';
import { deploymentStatusTone as parseDeploymentTone } from './deployment-status';
import { parseResourceStatus, type ResourceStatusTone } from './resource-status';

export type AppReference = {
    uuid: string;
    name: string;
};

export type ApplicationConfiguration = {
    build_pack: string | null;
    git_repository: string | null;
    git_branch: string | null;
    domains: string[];
    project: AppReference | null;
    environment: AppReference | null;
    server: AppReference | null;
    remote_workdir: string | null;
    base_directory: string | null;
};

export function parseApplicationConfiguration(configuration: Record<string, unknown>): ApplicationConfiguration {
    return {
        build_pack: stringOrNull(configuration.build_pack),
        git_repository: stringOrNull(configuration.git_repository),
        git_branch: stringOrNull(configuration.git_branch),
        domains: Array.isArray(configuration.domains)
            ? configuration.domains.filter((domain): domain is string => typeof domain === 'string')
            : [],
        project: parseReference(configuration.project),
        environment: parseReference(configuration.environment),
        server: parseReference(configuration.server),
        remote_workdir: stringOrNull(configuration.remote_workdir),
        base_directory: stringOrNull(configuration.base_directory),
    };
}

export function applicationStatusLabel(resource: CoreResource): string {
    return typeof resource.status === 'string' ? resource.status : 'running:healthy';
}

export function applicationStatusTone(status: string): ResourceStatusTone {
    return parseResourceStatus(status).tone;
}

export function deploymentStatusTone(status: string): ResourceStatusTone {
    return parseDeploymentTone(status);
}

export function shortCommit(commit: string | null): string | null {
    if (!commit) {
        return null;
    }

    return commit.slice(0, 7);
}

export function repositoryLabel(repository: string | null): string | null {
    if (!repository) {
        return null;
    }

    return repository
        .replace(/^https?:\/\//, '')
        .replace(/^git@([^:]+):/, '$1/')
        .replace(/\.git$/, '');
}

export function primaryDomain(domains: string[]): string | null {
    return domains[0] ?? null;
}

export function visitUrl(domain: string | null): string | null {
    if (!domain) {
        return null;
    }

    return domain.startsWith('http') ? domain : `https://${domain}`;
}

export function websiteScreenshotUrl(domain: string | null, width = 960): string | null {
    const url = visitUrl(domain);
    if (!url) {
        return null;
    }

    return `https://s.wordpress.com/mshots/v1/${encodeURIComponent(url)}?w=${width}`;
}

export function formatDateTime(value: string | null): string {
    if (!value) {
        return '—';
    }

    return new Date(value).toLocaleString('fr-FR', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

export function relativeUpdatedAt(value: string | null): string {
    if (!value) {
        return 'Date inconnue';
    }

    const deltaMs = Date.now() - new Date(value).getTime();
    const minutes = Math.round(deltaMs / 60000);
    if (minutes < 1) {
        return 'À l’instant';
    }
    if (minutes < 60) {
        return `Il y a ${minutes} min`;
    }

    const hours = Math.round(minutes / 60);
    if (hours < 48) {
        return `Il y a ${hours} h`;
    }

    return formatDateTime(value);
}

function parseReference(value: unknown): AppReference | null {
    if (!value || typeof value !== 'object') {
        return null;
    }

    const record = value as Record<string, unknown>;
    if (typeof record.uuid !== 'string' || typeof record.name !== 'string') {
        return null;
    }

    return { uuid: record.uuid, name: record.name };
}

function stringOrNull(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null;
}

export function latestDeployment(deployments: Deployment[]): Deployment | null {
    return deployments[0] ?? null;
}
