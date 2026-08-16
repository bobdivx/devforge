import { normalizeRoutePath } from './routing/route-path';

export function laravelGithubAppCallbackPath(pathname: string, search = ''): string | null {
    const path = normalizeRoutePath(pathname);
    const query = search.startsWith('?') || search === '' ? search : `?${search}`;

    if (path === '/webhooks/source/github/redirect') {
        return `/login/github/manifest${query}`;
    }

    if (path === '/webhooks/source/github/install') {
        return `/login/github/setup${query}`;
    }

    return null;
}
