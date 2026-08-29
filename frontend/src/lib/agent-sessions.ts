import type { Agent, AgentChatSession, AgentStatus } from './domain-api';
import { applicationPath } from './application-tabs';
import { agentDetailPath, AGENTS_CHAT_PATH } from './agent-routes';
import type { PandaAppState } from './pandaos-app-state';

export type SessionTimeBucketId = 'today' | 'yesterday' | 'week' | 'older';

export type SidebarAgentSession = {
    uuid: string;
    title: string;
    agentUuid: string;
    applicationUuid: string | null;
    applicationName: string;
    status: Extract<PandaAppState, 'idle' | 'running' | 'error'>;
    lastActivityAt: string | null;
};

export type SessionTimeBucket = {
    id: SessionTimeBucketId;
    label: string;
    sessions: SidebarAgentSession[];
};

export type GroupedApplicationSessions = {
    applicationUuid: string | null;
    applicationName: string;
    buckets: SessionTimeBucket[];
};

export const SESSION_TIME_BUCKETS: Array<{ id: SessionTimeBucketId; label: string }> = [
    { id: 'today', label: 'Aujourd’hui' },
    { id: 'yesterday', label: 'Hier' },
    { id: 'week', label: 'Cette semaine' },
    { id: 'older', label: 'Plus ancien' },
];

const APP_TITLE_PREFIX = /^App · (.+)$/;

export function parseAppSessionTitleName(title: string): string | null {
    const match = title.trim().match(APP_TITLE_PREFIX);
    const name = match?.[1]?.trim() ?? '';

    return name === '' ? null : name;
}

export function sessionStatusFromAgent(status: AgentStatus | string | null | undefined): SidebarAgentSession['status'] {
    if (status === 'running') {
        return 'running';
    }

    if (status === 'error') {
        return 'error';
    }

    return 'idle';
}

function startOfLocalDay(now: Date): number {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

export function sessionTimeBucket(iso: string | null | undefined, now: Date | number = Date.now()): SessionTimeBucketId {
    const timestamp = iso ? Date.parse(iso) : Number.NaN;
    const nowMs = now instanceof Date ? now.getTime() : now;

    if (!Number.isFinite(timestamp)) {
        return 'older';
    }

    const todayStart = startOfLocalDay(new Date(nowMs));
    const yesterdayStart = todayStart - 24 * 60 * 60 * 1000;
    const weekStart = todayStart - 6 * 24 * 60 * 60 * 1000;

    if (timestamp >= todayStart) {
        return 'today';
    }

    if (timestamp >= yesterdayStart) {
        return 'yesterday';
    }

    if (timestamp >= weekStart) {
        return 'week';
    }

    return 'older';
}

export function formatRelativeSessionTime(iso: string | null | undefined, now: Date | number = Date.now()): string {
    if (!iso) {
        return '';
    }

    const timestamp = Date.parse(iso);
    if (!Number.isFinite(timestamp)) {
        return '';
    }

    const nowMs = now instanceof Date ? now.getTime() : now;
    const diff = Math.max(0, nowMs - timestamp);
    const minutes = Math.floor(diff / 60000);

    if (minutes < 1) {
        return 'À l’instant';
    }

    if (minutes < 60) {
        return `Il y a ${minutes} min`;
    }

    const hours = Math.floor(minutes / 60);
    if (hours < 24) {
        return `Il y a ${hours} h`;
    }

    const days = Math.floor(hours / 24);
    if (days === 1) {
        return 'Hier';
    }

    if (days < 7) {
        return `Il y a ${days} j`;
    }

    return new Date(timestamp).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

function resolveApplication(
    agent: Agent,
    session: AgentChatSession,
    applications: Map<string, string>,
): { uuid: string | null; name: string } {
    if (agent.resource_uuid && applications.has(agent.resource_uuid)) {
        return {
            uuid: agent.resource_uuid,
            name: applications.get(agent.resource_uuid) ?? 'Application',
        };
    }

    const titled = parseAppSessionTitleName(session.title);
    if (titled) {
        for (const [uuid, name] of applications) {
            if (name === titled) {
                return { uuid, name };
            }
        }

        if (agent.resource_uuid) {
            return { uuid: agent.resource_uuid, name: titled };
        }

        return { uuid: null, name: titled };
    }

    if (agent.resource_uuid) {
        return {
            uuid: agent.resource_uuid,
            name: applications.get(agent.resource_uuid) ?? 'Application',
        };
    }

    return { uuid: null, name: 'Sans projet' };
}

export function buildSidebarSessions(
    agents: Agent[],
    sessionsByAgent: Record<string, AgentChatSession[]>,
    applications: Array<{ uuid: string; name: string }>,
): SidebarAgentSession[] {
    const appNames = new Map(applications.map((application) => [application.uuid, application.name]));
    const rows: SidebarAgentSession[] = [];

    for (const agent of agents) {
        const sessions = sessionsByAgent[agent.uuid] ?? [];

        for (const session of sessions) {
            const application = resolveApplication(agent, session, appNames);

            rows.push({
                uuid: session.uuid,
                title: session.title,
                agentUuid: agent.uuid,
                applicationUuid: application.uuid,
                applicationName: application.name,
                status: sessionStatusFromAgent(agent.status),
                lastActivityAt: session.last_message_at ?? session.created_at,
            });
        }
    }

    rows.sort((left, right) => {
        const leftTime = Date.parse(left.lastActivityAt ?? '') || 0;
        const rightTime = Date.parse(right.lastActivityAt ?? '') || 0;

        return rightTime - leftTime;
    });

    return rows;
}

export function groupSessionsByApplication(
    sessions: SidebarAgentSession[],
    now: Date | number = Date.now(),
): GroupedApplicationSessions[] {
    const groups = new Map<string, GroupedApplicationSessions>();
    const order: string[] = [];

    for (const session of sessions) {
        const key = session.applicationUuid ?? `name:${session.applicationName}`;
        let group = groups.get(key);

        if (!group) {
            group = {
                applicationUuid: session.applicationUuid,
                applicationName: session.applicationName,
                buckets: SESSION_TIME_BUCKETS.map((bucket) => ({ ...bucket, sessions: [] })),
            };
            groups.set(key, group);
            order.push(key);
        }

        const bucketId = sessionTimeBucket(session.lastActivityAt, now);
        const bucket = group.buckets.find((item) => item.id === bucketId);
        bucket?.sessions.push(session);
    }

    return order.map((key) => {
        const group = groups.get(key)!;

        return {
            ...group,
            buckets: group.buckets.filter((bucket) => bucket.sessions.length > 0),
        };
    });
}

export function withQuery(path: string, params: Record<string, string | null | undefined>): string {
    const queryIndex = path.search(/[?#]/);
    const pathname = queryIndex === -1 ? path : path.slice(0, queryIndex);
    const currentSearch = queryIndex === -1 || path[queryIndex] === '#'
        ? ''
        : path.slice(queryIndex + 1).split('#')[0] ?? '';
    const hash = path.includes('#') ? path.slice(path.indexOf('#')) : '';
    const search = new URLSearchParams(currentSearch);

    for (const [key, value] of Object.entries(params)) {
        if (value === null || value === undefined || value === '') {
            search.delete(key);
        } else {
            search.set(key, value);
        }
    }

    const query = search.toString();

    return query ? `${pathname}?${query}${hash}` : `${pathname}${hash}`;
}

export function sessionHref(session: SidebarAgentSession): string {
    if (session.applicationUuid) {
        return withQuery(applicationPath(session.applicationUuid, 'agents'), {
            session: session.uuid,
            agent: session.agentUuid,
        });
    }

    return agentDetailPath(session.agentUuid, { session: session.uuid });
}

export function newChatHref(applicationUuid: string | null): string {
    if (!applicationUuid) {
        return AGENTS_CHAT_PATH;
    }

    return withQuery(applicationPath(applicationUuid, 'agents'), { new: '1' });
}

export function hasRunningSidebarSession(sessions: SidebarAgentSession[]): boolean {
    return sessions.some((session) => session.status === 'running');
}
