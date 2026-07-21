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
            diff_preview: undefined,
            resolved: undefined,
        });
    });

    it('parses diff preview on write_application_source approval', () => {
        const pending = parsePendingToolApproval({
            pending_approval: {
                status: 'ask',
                tool: 'write_application_source',
                reason: 'Vérifiez le diff',
                diff_preview: {
                    path: 'Dockerfile',
                    is_new_file: false,
                    lines_added: 1,
                    lines_removed: 1,
                    diff: '--- a/Dockerfile\n+RUN npm ci',
                },
            },
        });

        expect(pending?.diff_preview).toEqual({
            path: 'Dockerfile',
            is_new_file: false,
            lines_added: 1,
            lines_removed: 1,
            diff: '--- a/Dockerfile\n+RUN npm ci',
            read_error: undefined,
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
