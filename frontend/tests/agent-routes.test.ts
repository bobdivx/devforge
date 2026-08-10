import { describe, expect, it, beforeEach } from 'vitest';
import {
    agentDetailPath,
    agentDetailSessionUuid,
    resolveContinueChatAgent,
    resolvePrimaryAgentChatPath,
    syncAgentDetailQuery,
} from '../src/lib/agent-routes';

describe('agent-routes sessions', () => {
    it('builds agent detail path with session query', () => {
        expect(agentDetailPath('abc-123', { session: 'sess-456' })).toBe('/agents/abc-123?session=sess-456');
    });

    it('reads session uuid from search params', () => {
        expect(agentDetailSessionUuid('?session=sess-789')).toBe('sess-789');
        expect(agentDetailSessionUuid('')).toBeNull();
    });

    it('syncs session into the url', () => {
        window.history.replaceState({}, '', '/agents/abc-123');

        syncAgentDetailQuery({ session: 'sess-111' });

        expect(window.location.search).toBe('?session=sess-111');
    });
});

describe('agent-routes primary chat resolution', () => {
    beforeEach(() => {
        window.localStorage.clear();
    });

    it('returns null when there are no agents', () => {
        expect(resolvePrimaryAgentChatPath([])).toBeNull();
        expect(resolveContinueChatAgent([])).toBeNull();
    });

    it('prefers the primary chat agent', () => {
        const agents = [
            { uuid: 'a', is_active: true },
            { uuid: 'b', is_active: true, is_primary_chat: true },
            { uuid: 'c', is_active: false },
        ];

        expect(resolvePrimaryAgentChatPath(agents, 'a')).toBe('/agents/b');
        expect(resolveContinueChatAgent(agents, 'a')?.uuid).toBe('b');
    });

    it('falls back to last opened then first active', () => {
        const agents = [
            { uuid: 'a', is_active: false },
            { uuid: 'b', is_active: true },
            { uuid: 'c', is_active: true },
        ];

        expect(resolvePrimaryAgentChatPath(agents, 'c')).toBe('/agents/c');
        expect(resolvePrimaryAgentChatPath(agents, 'missing')).toBe('/agents/b');
        expect(resolvePrimaryAgentChatPath(agents, null)).toBe('/agents/b');
    });
});
