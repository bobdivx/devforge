export function agentDetailPath(uuid: string, options?: {
    settings?: boolean;
    view?: 'chat' | 'runs';
    run?: string | null;
    session?: string | null;
}): string {
    const base = `/agents/${uuid}`;
    const params = new URLSearchParams();

    if (options?.settings) {
        params.set('settings', '1');
    }

    if (options?.view === 'runs') {
        params.set('view', 'runs');
    }

    if (options?.run) {
        params.set('run', options.run);
    }

    if (options?.session) {
        params.set('session', options.session);
    }

    const query = params.toString();

    return query ? `${base}?${query}` : base;
}

export function shouldOpenAgentSettings(search: string): boolean {
    const value = new URLSearchParams(search).get('settings');

    return value === '1' || value === 'true';
}

export function agentDetailView(search: string): 'chat' | 'runs' {
    return new URLSearchParams(search).get('view') === 'runs' ? 'runs' : 'chat';
}

export function agentDetailRunUuid(search: string): string | null {
    return new URLSearchParams(search).get('run');
}

export function agentDetailSessionUuid(search: string): string | null {
    return new URLSearchParams(search).get('session');
}

export function syncAgentDetailQuery(options: {
    settings?: boolean;
    view?: 'chat' | 'runs';
    run?: string | null;
    session?: string | null;
}): void {
    const url = new URL(window.location.href);

    if (options.settings) {
        url.searchParams.set('settings', '1');
    } else {
        url.searchParams.delete('settings');
    }

    if (options.view === 'runs') {
        url.searchParams.set('view', 'runs');
    } else {
        url.searchParams.delete('view');
    }

    if (options.run) {
        url.searchParams.set('run', options.run);
    } else {
        url.searchParams.delete('run');
    }

    if (options.session) {
        url.searchParams.set('session', options.session);
    } else if (options.view === 'runs') {
        url.searchParams.delete('session');
    } else if (options.session === null) {
        url.searchParams.delete('session');
    }

    const next = `${url.pathname}${url.search}${url.hash}`;
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;

    if (next !== current) {
        window.history.replaceState({}, '', next);
    }
}

export function syncAgentSettingsQueryParam(open: boolean): void {
    syncAgentDetailQuery({
        settings: open,
        view: agentDetailView(window.location.search),
        run: agentDetailRunUuid(window.location.search),
        session: agentDetailSessionUuid(window.location.search),
    });
}
