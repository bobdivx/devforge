import { normalizeRoutePath } from './route-path';

export type ProfileTabId = 'account' | 'appearance';

export function parseProfileTab(pathname: string): ProfileTabId {
    const normalized = normalizeRoutePath(pathname);

    if (normalized.startsWith('/profile/appearance')) {
        return 'appearance';
    }

    return 'account';
}

export function profileTabPath(tabId: ProfileTabId): string {
    return tabId === 'appearance' ? '/profile/appearance' : '/profile';
}
