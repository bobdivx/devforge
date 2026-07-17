import { describe, expect, it } from 'vitest';
import { isPendingToolApproval, parsePendingToolApproval } from '../src/lib/agent-pending-approval';

describe('parsePendingToolApproval', () => {
    it('returns null when metadata has no ask payload', () => {
        expect(parsePendingToolApproval(null)).toBeNull();
        expect(parsePendingToolApproval({})).toBeNull();
        expect(parsePendingToolApproval({ pending_approval: { status: 'deny', tool: 'x' } })).toBeNull();
    });

    it('parses a stable ask shape', () => {
        const pending = parsePendingToolApproval({
            pending_approval: {
                status: 'ask',
                tool: 'control_resource',
                reason: 'Outil destructif',
                rule_id: 'mode:tiered:destructive',
                approval_key: 'abc',
            },
        });

        expect(pending).toEqual({
            status: 'ask',
            tool: 'control_resource',
            reason: 'Outil destructif',
            rule_id: 'mode:tiered:destructive',
            approval_key: 'abc',
            resolved: undefined,
        });
    });

    it('detects unresolved pending approvals only', () => {
        expect(isPendingToolApproval({
            pending_approval: { status: 'ask', tool: 'exec_command', reason: 'plan-first' },
        })).toBe(true);

        expect(isPendingToolApproval({
            pending_approval: {
                status: 'ask',
                tool: 'exec_command',
                reason: 'plan-first',
                resolved: 'approved',
            },
        })).toBe(false);
    });
});
