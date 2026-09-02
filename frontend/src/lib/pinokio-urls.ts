export const DEFAULT_PINOKIO_HOST = '10.1.0.88';
export const DEFAULT_STUDIO_PORT = 42000;
export const DEFAULT_LLM_PORT = 10086;

export function normalizePinokioHost(raw: string): string {
    let trimmed = raw.trim();
    if (trimmed === '') {
        return '';
    }

    trimmed = trimmed.replace(/^https?:\/\//i, '');
    trimmed = trimmed.split('/')[0] ?? trimmed;

    const bracket = trimmed.match(/^\[([^\]]+)\]/);
    if (bracket) {
        return bracket[1];
    }

    const colonIndex = trimmed.lastIndexOf(':');
    if (colonIndex > 0 && trimmed.includes('.')) {
        const maybePort = trimmed.slice(colonIndex + 1);
        if (/^\d+$/.test(maybePort)) {
            return trimmed.slice(0, colonIndex);
        }
    }

    return trimmed.split(':')[0] ?? trimmed;
}

export function parsePortFromUrl(url: string, fallback: number): number {
    try {
        const normalized = /^https?:\/\//i.test(url) ? url : `http://${url}`;
        const parsed = new URL(normalized);
        if (parsed.port !== '') {
            return Number(parsed.port);
        }

        return parsed.protocol === 'https:' ? 443 : fallback;
    } catch {
        return fallback;
    }
}

export function parsePinokioEndpoints(
    studioUrl: string,
    llmUrl: string,
): { host: string; studioPort: number; llmPort: number } {
    const studioHost = normalizePinokioHost(studioUrl);
    const llmHost = normalizePinokioHost(llmUrl);

    return {
        host: studioHost || llmHost || DEFAULT_PINOKIO_HOST,
        studioPort: parsePortFromUrl(studioUrl, DEFAULT_STUDIO_PORT),
        llmPort: parsePortFromUrl(llmUrl.replace(/\/v1\/?$/i, ''), DEFAULT_LLM_PORT),
    };
}

export function buildStudioUrl(host: string, port: number = DEFAULT_STUDIO_PORT): string {
    const normalizedHost = normalizePinokioHost(host);
    if (normalizedHost === '') {
        return '';
    }

    return `http://${normalizedHost}:${port}`;
}

export function buildLlmUrl(host: string, port: number = DEFAULT_LLM_PORT): string {
    const base = buildStudioUrl(host, port);
    if (base === '') {
        return '';
    }

    return `${base}/v1`;
}

export const DEFAULT_STUDIO_URL = buildStudioUrl(DEFAULT_PINOKIO_HOST, DEFAULT_STUDIO_PORT);
export const DEFAULT_LLM_URL = buildLlmUrl(DEFAULT_PINOKIO_HOST, DEFAULT_LLM_PORT);
