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
    timeoutMs = 20_000,
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

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;

    try {
        response = await fetch(input, {
            ...init,
            credentials: 'include',
            headers,
            signal: controller.signal,
        });
    } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
            throw new ApiError(0, {
                message: `Délai dépassé (${Math.round(timeoutMs / 1000)} s) en attendant la réponse du serveur.`,
            });
        }

        throw new ApiError(0, {
            message: 'Impossible de joindre le serveur Coolify.',
        });
    } finally {
        window.clearTimeout(timeoutId);
    }

    const contentType = response.headers.get('content-type') ?? '';
    const payload = contentType.includes('application/json')
        ? await response.json()
        : await response.text();

    if (!response.ok) {
        throw new ApiError(response.status, payload);
    }

    return payload as T;
}

export type UploadProgressHandler = (loaded: number, total: number) => void;

export async function apiUploadWithProgress<T>(
    input: string,
    formData: FormData,
    onProgress?: UploadProgressHandler,
): Promise<T> {
    await ensureCsrfCookie();

    return new Promise<T>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', input);
        xhr.withCredentials = true;
        xhr.setRequestHeader('Accept', 'application/json');

        const csrfToken = readCookie('XSRF-TOKEN');
        if (csrfToken) {
            xhr.setRequestHeader('X-XSRF-TOKEN', csrfToken);
        }

        xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) {
                onProgress?.(event.loaded, event.total);
            }
        };

        xhr.onload = () => {
            const contentType = xhr.getResponseHeader('content-type') ?? '';
            let payload: unknown;

            try {
                payload = contentType.includes('application/json')
                    ? JSON.parse(xhr.responseText || 'null')
                    : xhr.responseText;
            } catch {
                reject(new ApiError(xhr.status, xhr.responseText));
                return;
            }

            if (xhr.status >= 200 && xhr.status < 300) {
                resolve(payload as T);
                return;
            }

            reject(new ApiError(xhr.status, payload));
        };

        xhr.onerror = () => reject(new ApiError(0, null));
        xhr.onabort = () => reject(new ApiError(0, null));
        xhr.send(formData);
    });
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
