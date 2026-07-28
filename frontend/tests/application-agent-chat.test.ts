import { describe, expect, it } from 'vitest';
import {
    applicationAgentSessionTitle,
    pickApplicationChatAgent,
    pickApplicationChatAgentPreferringSession,
} from '../src/lib/application-agent-chat';
import type { Agent } from '../src/lib/domain-api';

function agent(partial: Partial<Agent> & Pick<Agent, 'uuid' | 'type' | 'name'>): Agent {
    return {
        description: null,
        avatar_color: '#000',
        system_prompt: null,
        schedule_minutes: 0,
        trigger_mode: 'manual',
        is_active: true,
        status: 'idle',
        last_run_at: null,
        provider: {
            id: 1,
            name: 'Gemini',
            provider: 'gemini',
            model: 'gemini-2.5-flash',
        },
        fallback_provider: null,
        parent_agent_id: null,
        resource_uuid: null,
        sub_agents_count: 0,
        latest_run: null,
        created_at: '2026-07-01T00:00:00.000Z',
        ...partial,
    };
}

describe('application-agent-chat', () => {
    it('titre la session avec le préfixe App', () => {
        expect(applicationAgentSessionTitle('macompta')).toBe('App · macompta');
    });

    it('choisit un agent deployment lié à l’application en priorité', () => {
        const selected = pickApplicationChatAgent([
            agent({ uuid: 'a1', type: 'tech-watch', name: 'Watch' }),
            agent({ uuid: 'a2', type: 'deployment', name: 'Deploy', resource_uuid: null }),
            agent({
                uuid: 'a3',
                type: 'deployment',
                name: 'Deploy scoped',
                resource_uuid: 'app-1',
            }),
        ], 'app-1');

        expect(selected?.uuid).toBe('a3');
    });

    it('ignore les agents hors deployment/devforge/debug', () => {
        const selected = pickApplicationChatAgent([
            agent({ uuid: 'a1', type: 'tech-watch', name: 'Watch' }),
        ], 'app-1');

        expect(selected).toBeNull();
    });

    it('préfère l’agent qui a déjà la session App', () => {
        const selected = pickApplicationChatAgentPreferringSession(
            [
                agent({ uuid: 'a1', type: 'deployment', name: 'Deploy A' }),
                agent({ uuid: 'a2', type: 'devforge', name: 'Forge B' }),
            ],
            'app-1',
            'App · demo',
            new Set(['a2']),
        );

        expect(selected?.uuid).toBe('a2');
    });

    it('ignore les agents liés à une autre application', () => {
        const selected = pickApplicationChatAgent([
            agent({
                uuid: 'a1',
                type: 'deployment',
                name: 'Other',
                resource_uuid: 'other-app',
            }),
            agent({ uuid: 'a2', type: 'debug', name: 'Debug' }),
        ], 'app-1');

        expect(selected?.uuid).toBe('a2');
    });
});
