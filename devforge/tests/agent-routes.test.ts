import { describe, expect, it } from 'vitest';
import {
    agentDetailPath,
    agentDetailSessionUuid,
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
