import type { CoreAction, CoreResource } from './domain-api';

export function resourceStatusPrimary(status: CoreResource['status']): string {
    if (typeof status !== 'string') {
        return 'unknown';
    }

    return status.trim().toLowerCase().split(':')[0] ?? 'unknown';
}

export function isResourceRunning(status: CoreResource['status']): boolean {
    const primary = resourceStatusPrimary(status);

    return primary === 'running' || primary === 'degraded';
}

export function isResourceStopped(status: CoreResource['status']): boolean {
    const primary = resourceStatusPrimary(status);

    return primary === 'exited' || primary === 'stopped' || primary === 'dead';
}

export function resolveCoreResourceActions(resource: CoreResource): CoreAction[] {
    const allowed = new Set(resource.actions);
    const status = resource.status;

    if (typeof status !== 'string') {
        return resource.actions;
    }

    let resolved: CoreAction[] = [];

    if (resource.type === 'application') {
        resolved = isResourceStopped(status)
            ? ['start', 'deploy']
            : ['stop', 'restart', 'deploy'];
    } else if (resource.type === 'service') {
        resolved = isResourceStopped(status)
            ? ['start']
            : ['stop', 'restart', 'deploy'];
    } else if (resource.type === 'database') {
        resolved = isResourceStopped(status)
            ? ['start']
            : ['stop', 'restart'];
    } else {
        return resource.actions;
    }

    return resolved.filter((action) => allowed.has(action));
}

export function canVisitApplication(_status: CoreResource['status'], domain: string | null): boolean {
    // L’adresse provisoire (wildcard / FQDN) doit rester ouvrable dès qu’elle existe,
    // même si le conteneur n’est pas encore « running » (déploiement, restart, etc.).
    return typeof domain === 'string' && domain.trim() !== '';
}
