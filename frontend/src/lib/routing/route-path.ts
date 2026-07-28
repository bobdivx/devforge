/**
 * SPA URL prefix.
 * - Overlay / local tests: `/devforge` (Astro base `/devforge`)
 * - Standalone image (`DEVFORGE_SPA_BASE=/`): `` (empty → routes at `/`)
 */
function resolveDevforgeBasePath(): string {
    const spaBase = import.meta.env.DEVFORGE_SPA_BASE as string | undefined;
    if (spaBase !== undefined && spaBase !== null && String(spaBase).length > 0) {
        const normalized = String(spaBase).replace(/\/$/, '');
        return normalized === '/' || normalized === '' ? '' : normalized;
    }

    const baseUrl = (import.meta.env.BASE_URL ?? '/devforge').replace(/\/$/, '');
    if (baseUrl === '' || baseUrl === '/') {
        // Vite/Vitest default BASE_URL is `/` — keep overlay path unless SPA base was set.
        return '/devforge';
    }

    return baseUrl;
}

export const DEVFORGE_BASE_PATH = resolveDevforgeBasePath();

export function sanitizeResourceUuid(value: string | null | undefined): string | null {
    if (!value) {
        return null;
    }

    const normalized = value.trim().replace(/^\/+|\/+$/g, '');

    return normalized === '' ? null : normalized;
}

export function normalizeRoutePath(pathname: string): string {
    const pathOnly = pathname.split(/[?#]/)[0];
    const withoutBase =
        DEVFORGE_BASE_PATH !== '' && pathOnly.startsWith(DEVFORGE_BASE_PATH)
            ? pathOnly.slice(DEVFORGE_BASE_PATH.length)
            : pathOnly;

    const normalized = `/${withoutBase}`.replace(/\/+/g, '/').replace(/\/$/, '');

    return normalized === '' ? '/' : normalized;
}
