import { describe, expect, it } from 'vitest';
import { isPendingPlan, parsePendingPlan } from '../src/lib/agent-pending-plan';

describe('parsePendingPlan', () => {
    it('returns null when metadata has no ask plan', () => {
        expect(parsePendingPlan(null)).toBeNull();
        expect(parsePendingPlan({})).toBeNull();
        expect(parsePendingPlan({ pending_plan: { status: 'done', title: 'x' } })).toBeNull();
    });

    it('parses a stable plan shape', () => {
        const pending = parsePendingPlan({
            pending_plan: {
                status: 'ask',
                title: 'Corriger publish_directory',
                summary: 'Le site sert la page nginx.',
                steps: [
                    { id: '1', action: 'Lire les settings', tool: 'get_application_runtime_settings', risk: 'low' },
                    { action: 'Mettre à jour publish_directory', tool: 'update_application_runtime_settings', risk: 'medium' },
                ],
            },
        });

        expect(pending).toEqual({
            status: 'ask',
            title: 'Corriger publish_directory',
            summary: 'Le site sert la page nginx.',
            steps: [
                { id: '1', action: 'Lire les settings', tool: 'get_application_runtime_settings', risk: 'low' },
                { id: undefined, action: 'Mettre à jour publish_directory', tool: 'update_application_runtime_settings', risk: 'medium' },
            ],
            resolved: undefined,
        });
    });

    it('detects unresolved pending plans only', () => {
        expect(isPendingPlan({
            pending_plan: { status: 'ask', title: 'Plan', summary: '', steps: [] },
        })).toBe(true);

        expect(isPendingPlan({
            pending_plan: {
                status: 'ask',
                title: 'Plan',
                summary: '',
                steps: [],
                resolved: 'approved',
            },
        })).toBe(false);
    });
});
