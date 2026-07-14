export function agentDetailPath(uuid: string, options?: { settings?: boolean }): string {
    const base = `/agents/${uuid}`;

    return options?.settings ? `${base}?settings=1` : base;
}

export function shouldOpenAgentSettings(search: string): boolean {
    const value = new URLSearchParams(search).get('settings');

    return value === '1' || value === 'true';
}

export function syncAgentSettingsQueryParam(open: boolean): void {
    const url = new URL(window.location.href);

    if (open) {
        url.searchParams.set('settings', '1');
    } else {
        url.searchParams.delete('settings');
    }

    const next = `${url.pathname}${url.search}${url.hash}`;
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;

    if (next !== current) {
        window.history.replaceState({}, '', next);
    }
}
