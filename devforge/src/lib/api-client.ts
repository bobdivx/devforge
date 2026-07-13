import type { BootstrapResponse } from './bootstrap';

export class ApiError extends Error {
    constructor(
        public readonly status: number,
        public readonly payload: unknown,
    ) {
        super(extractApiMessage(status, payload));
        this.name = 'ApiError';
    }
}

function extractApiMessage(status: number, payload: unknown): string {
    if (payload && typeof payload === 'object') {
        const record = payload as Record<string, unknown>;
        if (typeof record.message === 'string' && record.message !== '') {
            return record.message;
        }
        const firstError = Object.values(record.errors ?? {})[0];
        if (Array.isArray(firstError) && typeof firstError[0] === 'string') {
            return firstError[0];
        }
    }

    return `La requête API a échoué avec le statut ${status}.`;
}

function readCookie(name: string): string | undefined {
    if (typeof document === 'undefined') {
        return undefined;
    }

    const encodedName = `${encodeURIComponent(name)}=`;
    const cookie = document.cookie
        .split(';')
        .map((part) => part.trim())
        .find((part) => part.startsWith(encodedName));

    return cookie ? decodeURIComponent(cookie.slice(encodedName.length)) : undefined;
}

function hasRequestBody(body: BodyInit | null | undefined): boolean {
    return body !== null && body !== undefined;
}

export async function ensureCsrfCookie(): Promise<void> {
    const response = await fetch('/sanctum/csrf-cookie', {
        credentials: 'include',
        headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
        throw new ApiError(response.status, null);
    }
}

export async function apiFetch<T>(
    input: string,
    init: RequestInit = {},
): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/json');

    if (
        hasRequestBody(init.body)
        && (typeof FormData === 'undefined' || !(init.body instanceof FormData))
    ) {
        headers.set('Content-Type', 'application/json');
    }

    const csrfToken = readCookie('XSRF-TOKEN');
    if (csrfToken) {
        headers.set('X-XSRF-TOKEN', csrfToken);
    }

    const response = await fetch(input, {
        ...init,
        credentials: 'include',
        headers,
    });
    const contentType = response.headers.get('content-type') ?? '';
    const payload = contentType.includes('application/json')
        ? await response.json()
        : await response.text();

    if (!response.ok) {
        throw new ApiError(response.status, payload);
    }

    return payload as T;
}

export function getBootstrap(): Promise<BootstrapResponse> {
    return apiFetch<BootstrapResponse>('/api/devforge/v1/bootstrap');
}

export async function switchTeam(teamId: number): Promise<BootstrapResponse> {
    await ensureCsrfCookie();

    return apiFetch<BootstrapResponse>('/api/devforge/v1/teams/switch', {
        method: 'POST',
        body: JSON.stringify({ team_id: teamId }),
    });
}
