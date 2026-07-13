import { describe, expect, it } from 'vitest';
import { isEventOnlyAgentType, scheduleLabel } from '../src/lib/agent-triggers';

describe('agent-triggers', () => {
    it('marks devforge as event-only', () => {
        expect(isEventOnlyAgentType('devforge')).toBe(true);
        expect(isEventOnlyAgentType('debug')).toBe(false);
    });

    it('labels devforge agents as webhook builds', () => {
        expect(scheduleLabel({
            type: 'devforge',
            schedule_minutes: 30,
            trigger_mode: 'webhook',
        })).toBe('À chaque build webhook');
    });
});
