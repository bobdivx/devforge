import { describe, expect, it } from 'vitest';
import type { Agent, AgentChatSession } from '../src/lib/domain-api';
import {
    buildSidebarSessions,
    groupSessionsByApplication,
    newChatHref,
    sessionHref,
    sessionTimeBucket,
} from '../src/lib/agent-sessions';

function agent(partial: Partial<Agent> & Pick<Agent, 'uuid' | 'name'>): Agent {
    return {
        id: 1,
        type: 'deployment',
        description: null,
        avatar_color: '#000',
        system_prompt: null,
        schedule_minutes: 0,
        trigger_mode: 'manual',
        is_active: true,
        status: 'idle',
        last_run_at: null,
        provider: null,
        fallback_provider: null,
        parent_agent_id: null,
        resource_uuid: null,
        sub_agents_count: 0,
        latest_run: null,
        created_at: '2026-08-29T08:00:00.000Z',
        ...partial,
    };
}

function session(partial: Partial<AgentChatSession> & Pick<AgentChatSession, 'uuid' | 'title'>): AgentChatSession {
    return {
        chat_mode: 'build',
        is_legacy: false,
        last_message_at: null,
        created_at: '2026-08-29T08:00:00.000Z',
        ...partial,
    };
}

const now = new Date('2026-08-29T16:00:00.000Z');

describe('agent-sessions grouping', () => {
    it('classe les sessions par application puis par seau temporel', () => {
        const deploy = agent({
            uuid: 'agent-deploy',
            name: 'Deploy',
            resource_uuid: 'app-1',
            status: 'running',
        });
        const chat = agent({ uuid: 'agent-chat', name: 'Chat', type: 'devforge' });

        const rows = buildSidebarSessions(
            [deploy, chat],
            {
                'agent-deploy': [
                    session({
                        uuid: 's-today',
                        title: 'Corriger le build',
                        last_message_at: '2026-08-29T15:10:00.000Z',
                    }),
                    session({
                        uuid: 's-yesterday',
                        title: 'App · popcorn-web',
                        last_message_at: '2026-08-28T12:00:00.000Z',
                    }),
                ],
                'agent-chat': [
                    session({
                        uuid: 's-old',
                        title: 'Idées',
                        last_message_at: '2026-08-10T09:00:00.000Z',
                        created_at: '2026-08-10T09:00:00.000Z',
                    }),
                ],
            },
            [{ uuid: 'app-1', name: 'popcorn-web' }],
        );

        const grouped = groupSessionsByApplication(rows, now);

        expect(grouped.map((group) => group.applicationName)).toEqual(['popcorn-web', 'Sans projet']);
        expect(grouped[0]?.applicationUuid).toBe('app-1');
        expect(grouped[0]?.buckets.map((bucket) => bucket.id)).toEqual(['today', 'yesterday']);
        expect(grouped[0]?.buckets[0]?.sessions.map((item) => item.uuid)).toEqual(['s-today']);
        expect(grouped[1]?.buckets.map((bucket) => bucket.id)).toEqual(['older']);
        expect(sessionTimeBucket('2026-08-24T10:00:00.000Z', now)).toBe('week');
        expect(sessionHref(rows[0]!)).toBe('/applications/app-1?tab=agents&session=s-today&agent=agent-deploy');
        expect(sessionHref(rows[2]!)).toBe('/agents/agent-chat?session=s-old');
        expect(newChatHref('app-1')).toBe('/applications/app-1?tab=agents&new=1');
        expect(newChatHref(null)).toBe('/agents/chat');
        expect(rows[0]?.status).toBe('running');
    });

    it('rattache une session « App · nom » même sans resource_uuid agent', () => {
        const rows = buildSidebarSessions(
            [agent({ uuid: 'agent-1', name: 'Forge', type: 'devforge' })],
            {
                'agent-1': [
                    session({
                        uuid: 's-app',
                        title: 'App · macompta',
                        last_message_at: '2026-08-29T15:00:00.000Z',
                    }),
                ],
            },
            [{ uuid: 'app-mac', name: 'macompta' }],
        );

        expect(rows[0]?.applicationUuid).toBe('app-mac');
        expect(rows[0]?.applicationName).toBe('macompta');
    });
});
