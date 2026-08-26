/**
 * Résout une URL de logo pour une application core (favicon domaine, sinon avatar GitHub).
 */

function asStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }

    return value.filter((item): item is string => typeof item === 'string' && item.trim() !== '');
}

function hostnameFromCandidate(candidate: string): string | null {
    const trimmed = candidate.trim();
    if (!trimmed) {
        return null;
    }

    try {
        const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
        const hostname = new URL(withScheme).hostname.trim().toLowerCase();

        return hostname || null;
    } catch {
        return null;
    }
}

function githubOwnerFromRepository(repository: string | null | undefined): string | null {
    if (!repository) {
        return null;
    }

    const trimmed = repository.trim();
    const patterns = [
        /^https?:\/\/(?:www\.)?github\.com\/([^\/\s?#]+)(?:\/|$)/i,
        /^git@github\.com:([^\/\s]+)(?:\/|$)/i,
    ];

    for (const pattern of patterns) {
        const match = trimmed.match(pattern);
        const owner = match?.[1]?.trim();
        if (owner && owner !== '.' && owner !== '..') {
            return owner;
        }
    }

    return null;
}

function isGeneratedApplicationHostname(hostname: string): boolean {
    const label = hostname.split('.')[0] ?? '';

    return /^[a-z0-9]{20,}$/i.test(label);
}

export function resolveApplicationLogoUrl(configuration: Record<string, unknown> | null | undefined): string | null {
    const domains = asStringArray(configuration?.domains);
    for (const domain of domains) {
        const hostname = hostnameFromCandidate(domain);
        if (hostname && !isGeneratedApplicationHostname(hostname)) {
            // Try app's own favicon first, fallback to Google if it fails
            const withScheme = hostname.includes('://') ? hostname : `https://${hostname}`;
            return `${withScheme}/favicon.ico`;
        }
    }

    const repository = typeof configuration?.git_repository === 'string'
        ? configuration.git_repository
        : null;
    const owner = githubOwnerFromRepository(repository);
    if (owner) {
        return `https://github.com/${encodeURIComponent(owner)}.png?size=64`;
    }

    return null;
}
