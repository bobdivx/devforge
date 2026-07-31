import { describe, expect, it } from 'vitest';
import {
    agentPresets,
    defaultScheduleForType,
    subAgentPresetsForParent,
} from '../src/lib/agent-presets';
import { isEventOnlyAgentType } from '../src/lib/agent-triggers';

describe('agent presets', () => {
    it('couvre tous les types d’agents avec un déclencheur explicite', () => {
        const types = agentPresets.map((preset) => preset.type);

        expect(types).toEqual(expect.arrayContaining([
            'deployment',
            'github-actions',
            'devforge',
            'debug',
            'github',
            'tech-watch',
            'security',
        ]));

        for (const preset of agentPresets) {
            expect(preset.triggerHint.length).toBeGreaterThan(5);
            if (isEventOnlyAgentType(preset.type)) {
                expect(preset.defaultScheduleMinutes).toBe(0);
                expect(defaultScheduleForType(preset.type)).toBe(0);
            }
        }
    });

    it('propose des spécialistes adaptés au parent', () => {
        expect(subAgentPresetsForParent('deployment').map((p) => p.id)).toEqual([
            'diagnose',
            'fix',
            'redeploy',
        ]);
        expect(subAgentPresetsForParent('github-actions').some((p) => p.id === 'fix-ci')).toBe(true);
        expect(subAgentPresetsForParent('security')[0]?.type).toBe('security');
    });
});
