import type { AgentKeyRequest, SharedVariable } from './domain-api';

export type ConnexionId = 'github' | 'turso' | 'team' | 'mcp';
export type ConnexionStatus = 'connected' | 'needs_setup' | 'agent_request';

export const DATABASE_URL_ALIASES = new Set([
    'DATABASE_URL',
    'DATABASE_URL_MACOMPTA',
    'DATABASE_URL_VALIDATED',
    'DATABASE_URL_CORRECT',
    'CORRECT_DB_URL',
    'NEW_DB_REMOTE_URL',
    'ASTRO_DB_REMOTE_URL',
    'TURSO_DATABASE_URL',
]);

/** Clés déjà fournies par la plateforme — pas des cartes produit. */
export const IGNORED_PRODUCT_KEYS = new Set([
    'HEALTH_GATEWAY',
    'LOCALHOST_SERVER_UUID',
    'APPLICATION_UUID',
]);

export const CONNEXION_STATUS_LABEL: Record<ConnexionStatus, string> = {
    connected: 'Branché',
    needs_setup: 'À configurer',
    agent_request: 'Demande agent',
};

export const CONNEXION_STATUS_TONE: Record<ConnexionStatus, 'success' | 'neutral' | 'warning'> = {
    connected: 'success',
    needs_setup: 'neutral',
    agent_request: 'warning',
};

export function normalizeKeyName(keyName: string | null | undefined): string {
    return (keyName ?? '').trim().toUpperCase();
}

export function logicalAgentKey(keyName: string | null | undefined): string {
    const raw = normalizeKeyName(keyName);
    return DATABASE_URL_ALIASES.has(raw) ? 'DATABASE_URL' : raw;
}

export function isIgnoredProductKey(keyName: string | null | undefined): boolean {
    return IGNORED_PRODUCT_KEYS.has(logicalAgentKey(keyName));
}

export function isGithubPatKey(keyName: string | null | undefined): boolean {
    const key = logicalAgentKey(keyName);
    if (key === 'GH_PAT' || key === 'GH_TOKEN' || key === 'GH_PACKAGES_TOKEN') {
        return true;
    }

    if (key.startsWith('GITHUB_PAT_') || key.startsWith('GH_PAT_')) {
        return true;
    }

    return key.includes('GITHUB') && (key.includes('PAT') || key.includes('TOKEN') || key.includes('PACKAGES'));
}

export function isTursoKey(keyName: string | null | undefined): boolean {
    const key = logicalAgentKey(keyName);
    return key === 'DATABASE_URL' || key.includes('TURSO');
}

export function connexionIdForKey(keyName: string | null | undefined): ConnexionId | null {
    if (isIgnoredProductKey(keyName)) {
        return null;
    }

    if (isTursoKey(keyName)) {
        return 'turso';
    }

    if (isGithubPatKey(keyName)) {
        return 'github';
    }

    return 'team';
}

export function isPendingAgentRequest(request: AgentKeyRequest): boolean {
    const status = (request.status ?? 'pending').toLowerCase();
    return status === 'pending' || status === 'waiting' || status === 'open' || status === 'requested';
}

export function groupAgentRequests(rows: AgentKeyRequest[]): AgentKeyRequest[] {
    const seen = new Map<string, AgentKeyRequest>();

    for (const request of rows) {
        if (!isPendingAgentRequest(request)) {
            continue;
        }

        const logical = logicalAgentKey(request.key_name);
        const key = `${logical}|${request.resource_uuid ?? ''}`;
        if (!seen.has(key)) {
            seen.set(key, request);
        }
    }

    return Array.from(seen.values());
}

export function requestsForConnexion(rows: AgentKeyRequest[], id: ConnexionId): AgentKeyRequest[] {
    return groupAgentRequests(rows).filter((request) => connexionIdForKey(request.key_name) === id);
}

export function teamHasDefinedKey(variables: SharedVariable[], predicate: (key: string) => boolean): boolean {
    return variables.some((variable) => predicate(variable.key) && Boolean(variable.value));
}

export function resolveConnexionStatus(options: {
    id: ConnexionId;
    requests: AgentKeyRequest[];
    githubInstalled: boolean;
    tursoConfigured: boolean;
    teamKeysConfigured: boolean;
    mcpConfigured: boolean;
}): ConnexionStatus {
    if (requestsForConnexion(options.requests, options.id).length > 0) {
        return 'agent_request';
    }

    if (options.id === 'github') {
        return options.githubInstalled ? 'connected' : 'needs_setup';
    }

    if (options.id === 'turso') {
        return options.tursoConfigured ? 'connected' : 'needs_setup';
    }

    if (options.id === 'team') {
        return options.teamKeysConfigured ? 'connected' : 'needs_setup';
    }

    return options.mcpConfigured ? 'connected' : 'needs_setup';
}

export function matchesConnexionQuery(
    query: string,
    item: { title: string; description: string; status: ConnexionStatus },
): boolean {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
        return true;
    }

    return [
        item.title,
        item.description,
        CONNEXION_STATUS_LABEL[item.status],
    ].join(' ').toLowerCase().includes(normalized);
}
