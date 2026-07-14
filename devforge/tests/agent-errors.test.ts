import { describe, expect, it } from 'vitest';
import { getAgentErrorMessage, hasAgentError } from '../src/lib/agent-errors';
import type { Agent } from '../src/lib/domain-api';

function makeAgent(overrides: Partial<Agent> = {}): Agent {
    return {
        uuid: 'agent-1',
        type: 'debug',
        name: 'Debug',
        description: null,
        avatar_color: '#6366f1',
        system_prompt: null,
        schedule_minutes: 15,
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
        created_at: '2026-07-13T00:00:00.000Z',
        ...overrides,
    };
}

describe('agent-errors', () => {
    it('returns a friendly message for gemini overload errors', () => {
        const agent = makeAgent({
            status: 'error',
            latest_run: {
                uuid: 'run-1',
                status: 'failed',
                trigger: 'manual',
                summary: 'Erreur: Gemini API error [503]: high demand',
                tokens_used: 0,
                iterations: 0,
                started_at: null,
                finished_at: '2026-07-13T00:00:00.000Z',
                created_at: '2026-07-13T00:00:00.000Z',
            },
        });

        expect(getAgentErrorMessage(agent)).toContain('secours');
    });

    it('returns the latest run summary when the agent is in error', () => {
        const agent = makeAgent({
            status: 'error',
            latest_run: {
                uuid: 'run-1',
                status: 'failed',
                trigger: 'manual',
                summary: 'Gemini API error [400]: invalid payload',
                tokens_used: 0,
                iterations: 0,
                started_at: null,
                finished_at: '2026-07-13T00:00:00.000Z',
                created_at: '2026-07-13T00:00:00.000Z',
            },
        });

        expect(getAgentErrorMessage(agent)).toBe('Gemini API error [400]: invalid payload');
        expect(hasAgentError(agent)).toBe(true);
    });

    it('returns null when there is no error', () => {
        const agent = makeAgent({
            status: 'idle',
            latest_run: {
                uuid: 'run-1',
                status: 'completed',
                trigger: 'manual',
                summary: 'Tout va bien',
                tokens_used: 10,
                iterations: 1,
                started_at: null,
                finished_at: '2026-07-13T00:00:00.000Z',
                created_at: '2026-07-13T00:00:00.000Z',
            },
        });

        expect(getAgentErrorMessage(agent)).toBeNull();
        expect(hasAgentError(agent)).toBe(false);
    });

    it('hides stale failed runs once the agent is ready again', () => {
        const agent = makeAgent({
            status: 'idle',
            latest_run: {
                uuid: 'run-1',
                status: 'failed',
                trigger: 'event',
                summary: 'Erreur: ancien bug corrigé',
                tokens_used: 0,
                iterations: 0,
                started_at: null,
                finished_at: '2026-07-13T00:00:00.000Z',
                created_at: '2026-07-13T00:00:00.000Z',
            },
        });

        expect(getAgentErrorMessage(agent)).toBeNull();
        expect(hasAgentError(agent)).toBe(false);
    });
});
