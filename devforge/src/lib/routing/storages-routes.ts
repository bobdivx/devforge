import { normalizeRoutePath } from '../route-path';

export function extractStorageUuid(pathname: string): string | null {
    const normalized = normalizeRoutePath(pathname);
    const match = normalized.match(/^\/storages\/([^/]+)/);

    return match?.[1] ?? null;
}

export function storageShowsResources(pathname: string): boolean {
    return normalizeRoutePath(pathname).endsWith('/resources');
}

export function storageLegacyPath(storageUuid: string, resources = false): string {
    return resources ? `/storages/${storageUuid}/resources` : `/storages/${storageUuid}`;
}
