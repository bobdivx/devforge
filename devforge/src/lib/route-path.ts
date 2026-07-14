export const DEVFORGE_BASE_PATH = '/devforge';

export function sanitizeResourceUuid(value: string | null | undefined): string | null {
    if (!value) {
        return null;
    }

    const normalized = value.trim().replace(/^\/+|\/+$/g, '');

    return normalized === '' ? null : normalized;
}

export function normalizeRoutePath(pathname: string): string {
    const withoutBase = pathname.startsWith(DEVFORGE_BASE_PATH)
        ? pathname.slice(DEVFORGE_BASE_PATH.length)
        : pathname;

    const normalized = `/${withoutBase}`.replace(/\/+/g, '/').replace(/\/$/, '');

    return normalized === '' ? '/' : normalized;
}
