import type { ApplicationReadiness, CoreResource, Deployment } from '../lib/domain-api';
import { deploymentStatusTone as parseDeploymentTone } from './deployment-status';
import { parseResourceStatus, type ResourceStatusTone } from './resource-status';

export type PreviewAvailability = {
    ready: boolean;
    label: string | null;
    tone: 'error' | 'warning' | 'neutral';
};

export function shouldPollApplicationReadiness(status: ApplicationReadiness['status']): boolean {
    return status === 'probing' || status === 'recovering' || status === 'awaiting_user';
}

export function resolvePreviewAvailability(
    resourceStatus: string,
    readiness: ApplicationReadiness | null,
    readinessLoading = false,
): PreviewAvailability {
    const primary = resourceStatus.trim().toLowerCase().split(':')[0] ?? '';

    if (primary === 'exited' || primary === 'stopped' || primary === 'dead') {
        return { ready: false, label: 'Arrêté', tone: 'error' };
    }

    if (primary === 'starting' || primary === 'created' || primary === 'restarting') {
        return { ready: false, label: 'Démarrage…', tone: 'warning' };
    }

    if (readinessLoading && !readiness) {
        return { ready: false, label: 'Vérification…', tone: 'warning' };
    }

    if (readiness) {
        if (readiness.status === 'healthy' || readiness.last_probe_ok === true) {
            return { ready: true, label: null, tone: 'neutral' };
        }

        if (readiness.status === 'probing' || readiness.status === 'recovering') {
            return {
                ready: false,
                label: readiness.status === 'probing' ? 'Vérification…' : 'Récupération…',
                tone: 'warning',
            };
        }

        if (readiness.status === 'awaiting_user') {
            return { ready: false, label: 'Action requise', tone: 'warning' };
        }

        if (readiness.status === 'failed' || readiness.last_probe_ok === false) {
            return { ready: false, label: 'URL inaccessible', tone: 'error' };
        }

        if (readiness.status === 'idle' || readiness.degraded) {
            return { ready: false, label: 'Non prêt', tone: 'warning' };
        }
    }

    const parsed = parseResourceStatus(resourceStatus);
    if (parsed.tone === 'success') {
        return { ready: true, label: null, tone: 'neutral' };
    }

    if (parsed.tone === 'error') {
        return { ready: false, label: 'Non prêt', tone: 'error' };
    }

    return { ready: false, label: 'Non prêt', tone: 'warning' };
}

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
    publish_directory: string | null;
    detected_framework: string | null;
    ports_exposes: string | null;
    start_command: string | null;
    install_command: string | null;
    build_command: string | null;
    is_static: boolean;
    health_check_enabled: boolean;
    health_check_path: string | null;
    health_check_port: string | null;
};

const FRAMEWORK_LABELS: Record<string, string> = {
    'astro-static': 'Astro static',
    'astro-ssr': 'Astro SSR',
    vite: 'Vite',
    next: 'Next.js',
    nuxt: 'Nuxt',
    node: 'Node',
    static: 'Site statique',
    dockerfile: 'Dockerfile',
};

export function deploymentSystemLabel(config: Pick<
    ApplicationConfiguration,
    'detected_framework' | 'build_pack' | 'is_static'
>): string {
    const framework = config.detected_framework?.trim();
    if (framework && framework !== 'unknown') {
        return FRAMEWORK_LABELS[framework] ?? framework;
    }

    const pack = config.build_pack?.trim();
    if (!pack) {
        return '—';
    }

    if (config.is_static) {
        return `${pack} · statique`;
    }

    return pack;
}

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
        publish_directory: stringOrNull(configuration.publish_directory),
        detected_framework: stringOrNull(configuration.detected_framework),
        ports_exposes: stringOrNull(configuration.ports_exposes),
        start_command: stringOrNull(configuration.start_command),
        install_command: stringOrNull(configuration.install_command),
        build_command: stringOrNull(configuration.build_command),
        is_static: configuration.is_static === true,
        health_check_enabled: configuration.health_check_enabled === true,
        health_check_path: stringOrNull(configuration.health_check_path),
        health_check_port: stringOrNull(configuration.health_check_port),
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

export function ensureDomainScheme(domain: string): string {
    const trimmed = domain.trim();
    if (!trimmed) {
        return '';
    }

    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
        return trimmed;
    }

    return `https://${trimmed}`;
}

export function visitUrl(domain: string | null): string | null {
    if (!domain) {
        return null;
    }

    return ensureDomainScheme(domain) || null;
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
