import { describe, expect, it } from 'vitest';
import { isTerminalAgentRunStatus } from '../src/lib/agent-run-tracker';

describe('agent run chat polish', () => {
    it('traite cancelled comme statut terminal', () => {
        expect(isTerminalAgentRunStatus('cancelled')).toBe(true);
        expect(isTerminalAgentRunStatus('running')).toBe(false);
        expect(isTerminalAgentRunStatus('waiting_for_subagents')).toBe(false);
    });
});
