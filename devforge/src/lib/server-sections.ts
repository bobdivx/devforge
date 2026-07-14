import { normalizeRoutePath } from './route-path';

export type ServerSectionId =
    | 'overview'
    | 'advanced'
    | 'swarm'
    | 'sentinel'
    | 'sentinel-logs'
    | 'private-key'
    | 'cloud-provider-token'
    | 'ca-certificate'
    | 'resources'
    | 'cloudflare-tunnel'
    | 'destinations'
    | 'log-drains'
    | 'metrics'
    | 'danger'
    | 'proxy'
    | 'proxy-dynamic'
    | 'proxy-logs'
    | 'terminal'
    | 'docker-cleanup'
    | 'security-patches'
    | 'security-terminal-access';

export type ServerSection = {
    id: ServerSectionId;
    label: string;
    legacySuffix: string;
    description: string;
};

export const serverSections: ServerSection[] = [
    { id: 'overview', label: 'Vue d’ensemble', legacySuffix: '', description: 'État et configuration générale du serveur.' },
    { id: 'resources', label: 'Ressources', legacySuffix: '/resources', description: 'Applications, services et bases déployés sur ce serveur.' },
    { id: 'destinations', label: 'Destinations', legacySuffix: '/destinations', description: 'Réseaux Docker et destinations de déploiement.' },
    { id: 'metrics', label: 'Métriques', legacySuffix: '/metrics', description: 'Métriques système et conteneurs.' },
    { id: 'proxy', label: 'Proxy', legacySuffix: '/proxy', description: 'Configuration du reverse proxy Traefik/Caddy.' },
    { id: 'proxy-dynamic', label: 'Proxy dynamique', legacySuffix: '/proxy/dynamic', description: 'Configurations dynamiques du proxy.' },
    { id: 'proxy-logs', label: 'Logs proxy', legacySuffix: '/proxy/logs', description: 'Journaux du reverse proxy.' },
    { id: 'sentinel', label: 'Sentinel', legacySuffix: '/sentinel', description: 'Agent de supervision Coolify.' },
    { id: 'sentinel-logs', label: 'Logs Sentinel', legacySuffix: '/sentinel/logs', description: 'Journaux de l’agent Sentinel.' },
    { id: 'terminal', label: 'Terminal', legacySuffix: '/terminal', description: 'Terminal SSH du serveur.' },
    { id: 'advanced', label: 'Avancé', legacySuffix: '/advanced', description: 'Paramètres avancés du serveur.' },
    { id: 'swarm', label: 'Swarm', legacySuffix: '/swarm', description: 'Cluster Docker Swarm.' },
    { id: 'private-key', label: 'Clé privée', legacySuffix: '/private-key', description: 'Clé SSH utilisée pour ce serveur.' },
    { id: 'cloud-provider-token', label: 'Jeton cloud', legacySuffix: '/cloud-provider-token', description: 'Jeton du fournisseur cloud.' },
    { id: 'ca-certificate', label: 'Certificat CA', legacySuffix: '/ca-certificate', description: 'Certificat d’autorité du serveur.' },
    { id: 'cloudflare-tunnel', label: 'Tunnel Cloudflare', legacySuffix: '/cloudflare-tunnel', description: 'Configuration du tunnel Cloudflare.' },
    { id: 'log-drains', label: 'Log drains', legacySuffix: '/log-drains', description: 'Export des journaux vers des services externes.' },
    { id: 'docker-cleanup', label: 'Nettoyage Docker', legacySuffix: '/docker-cleanup', description: 'Politiques de nettoyage des images et conteneurs.' },
    { id: 'security-patches', label: 'Correctifs sécurité', legacySuffix: '/security/patches', description: 'Correctifs de sécurité système.' },
    { id: 'security-terminal-access', label: 'Accès terminal', legacySuffix: '/security/terminal-access', description: 'Contrôle d’accès au terminal.' },
    { id: 'danger', label: 'Zone dangereuse', legacySuffix: '/danger', description: 'Suppression et actions irréversibles.' },
];

const legacyPathBySection: Record<string, ServerSectionId> = {
    '': 'overview',
    resources: 'resources',
    destinations: 'destinations',
    metrics: 'metrics',
    proxy: 'proxy',
    'proxy/dynamic': 'proxy-dynamic',
    'proxy/logs': 'proxy-logs',
    sentinel: 'sentinel',
    'sentinel/logs': 'sentinel-logs',
    terminal: 'terminal',
    advanced: 'advanced',
    swarm: 'swarm',
    'private-key': 'private-key',
    'cloud-provider-token': 'cloud-provider-token',
    'ca-certificate': 'ca-certificate',
    'cloudflare-tunnel': 'cloudflare-tunnel',
    'log-drains': 'log-drains',
    'docker-cleanup': 'docker-cleanup',
    'security/patches': 'security-patches',
    'security/terminal-access': 'security-terminal-access',
    danger: 'danger',
};

export function extractServerUuid(pathname: string): string | null {
    const normalized = normalizeRoutePath(pathname);
    const match = normalized.match(/^\/server\/([^/]+)/);

    return match?.[1] ?? null;
}

export function parseServerSection(pathname: string): ServerSectionId {
    const normalized = normalizeRoutePath(pathname);
    const match = normalized.match(/^\/server\/[^/]+\/?(.*)$/);
    const legacyPath = match?.[1] ?? '';

    return legacyPathBySection[legacyPath] ?? 'overview';
}

export function serverLegacyPath(serverUuid: string, section: ServerSectionId): string {
    const sectionMeta = serverSections.find(({ id }) => id === section) ?? serverSections[0];

    return `/server/${serverUuid}${sectionMeta.legacySuffix}`;
}

export function extractDestinationUuid(pathname: string): string | null {
    const normalized = normalizeRoutePath(pathname);
    const match = normalized.match(/^\/destination\/([^/]+)/);

    return match?.[1] ?? null;
}

export function destinationShowsResources(pathname: string): boolean {
    return normalizeRoutePath(pathname).endsWith('/resources');
}

export function extractTagName(pathname: string): string | null {
    const normalized = normalizeRoutePath(pathname);
    const match = normalized.match(/^\/tags\/([^/]+)/);

    return match?.[1] ? decodeURIComponent(match[1]) : null;
}
