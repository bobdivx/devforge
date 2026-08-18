import { describe, expect, it } from 'vitest';
import {
    DEFAULT_AUTOMATION_NAME,
    DEFAULT_AUTOMATION_PRESET_ID,
    defaultAutomationInput,
    isScheduledAutomation,
    selectScheduledAutomations,
} from '../src/lib/agent-automations';
import type { Agent } from '../src/lib/domain-api';

function agent(overrides: Partial<Agent> = {}): Agent {
    return {
        id: 1,
        uuid: 'agent-1',
        type: 'tech-watch',
        name: 'Veille',
        description: null,
        avatar_color: '#6366f1',
        system_prompt: null,
        schedule_minutes: 0,
        schedule_cron: null,
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
        created_at: '2026-08-18T00:00:00Z',
        ...overrides,
    };
}

describe('agent automations', () => {
    it('reconnaît un cron jours ouvrés comme automation planifiée', () => {
        expect(isScheduledAutomation(agent({ schedule_cron: '0 9 * * 1-5' }))).toBe(true);
        expect(isScheduledAutomation(agent({ schedule_minutes: 60 }))).toBe(true);
        expect(isScheduledAutomation(agent({ type: 'github-actions', schedule_minutes: 15 }))).toBe(false);
        expect(isScheduledAutomation(agent())).toBe(false);
    });

    it('filtre uniquement les agents planifiés', () => {
        const selected = selectScheduledAutomations([
            agent({ uuid: 'a', schedule_cron: '0 9 * * 1-5' }),
            agent({ uuid: 'b', type: 'devforge' }),
            agent({ uuid: 'c' }),
        ]);

        expect(selected.map((row) => row.uuid)).toEqual(['a']);
    });

    it('prépare la santé quotidienne en jours ouvrés à 9h', () => {
        const input = defaultAutomationInput();

        expect(input.name).toBe(DEFAULT_AUTOMATION_NAME);
        expect(input.type).toBe('tech-watch');
        expect(input.schedule_cron).toBe('0 9 * * 1-5');
        expect(input.heartbeat_enabled).toBe(true);
        expect(input.is_active).toBe(true);
        expect(DEFAULT_AUTOMATION_PRESET_ID).toBe('workday-morning');
    });
});
