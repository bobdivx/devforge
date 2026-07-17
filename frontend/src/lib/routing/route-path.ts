export const DEVFORGE_BASE_PATH = '/devforge';

export function sanitizeResourceUuid(value: string | null | undefined): string | null {
    if (!value) {
        return null;
    }

    const normalized = value.trim().replace(/^\/+|\/+$/g, '');

    return normalized === '' ? null : normalized;
}

export function normalizeRoutePath(pathname: string): string {
    const pathOnly = pathname.split(/[?#]/)[0];
    const withoutBase = pathOnly.startsWith(DEVFORGE_BASE_PATH)
        ? pathOnly.slice(DEVFORGE_BASE_PATH.length)
        : pathOnly;

    const normalized = `/${withoutBase}`.replace(/\/+/g, '/').replace(/\/$/, '');

    return normalized === '' ? '/' : normalized;
}
