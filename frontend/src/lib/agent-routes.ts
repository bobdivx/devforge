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

export const AGENTS_CHAT_PATH = '/agents/chat';

export const LAST_AGENT_CHAT_STORAGE_KEY = 'devforge.last_agent_chat_uuid';

export type AgentChatCandidate = {
    uuid: string;
    is_active?: boolean;
    is_primary_chat?: boolean;
};

export function rememberLastAgentChatUuid(uuid: string): void {
    try {
        window.localStorage.setItem(LAST_AGENT_CHAT_STORAGE_KEY, uuid);
    } catch {
        // ignore quota / private mode
    }
}

export function readLastAgentChatUuid(): string | null {
    try {
        const value = window.localStorage.getItem(LAST_AGENT_CHAT_STORAGE_KEY);
        return value && value.trim() !== '' ? value : null;
    } catch {
        return null;
    }
}

/**
 * Résout le chat principal : primary → last opened → premier actif → premier.
 * Retourne null si la liste est vide.
 */
export function resolvePrimaryAgentChatPath(
    agents: AgentChatCandidate[],
    lastUuid: string | null = typeof window !== 'undefined' ? readLastAgentChatUuid() : null,
): string | null {
    if (agents.length === 0) {
        return null;
    }

    const primary = agents.find((agent) => agent.is_primary_chat === true);
    if (primary) {
        return agentDetailPath(primary.uuid);
    }

    if (lastUuid) {
        const last = agents.find((agent) => agent.uuid === lastUuid);
        if (last) {
            return agentDetailPath(last.uuid);
        }
    }

    const active = agents.find((agent) => agent.is_active !== false);
    if (active) {
        return agentDetailPath(active.uuid);
    }

    return agentDetailPath(agents[0]!.uuid);
}

export function resolveContinueChatAgent(
    agents: AgentChatCandidate[],
    lastUuid: string | null = typeof window !== 'undefined' ? readLastAgentChatUuid() : null,
): AgentChatCandidate | null {
    if (agents.length === 0) {
        return null;
    }

    const primary = agents.find((agent) => agent.is_primary_chat === true);
    if (primary) {
        return primary;
    }

    if (lastUuid) {
        const last = agents.find((agent) => agent.uuid === lastUuid);
        if (last) {
            return last;
        }
    }

    return agents.find((agent) => agent.is_active !== false) ?? agents[0] ?? null;
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
