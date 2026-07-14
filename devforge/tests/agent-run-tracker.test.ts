import { describe, expect, it } from 'vitest';
import {
    agentRunProgressLabel,
    isTerminalAgentRunStatus,
    parseLastAgentLogLine,
} from '../src/lib/agent-run-tracker';
import type { AgentRun } from '../src/lib/domain-api';

function makeRun(overrides: Partial<AgentRun> = {}): AgentRun {
    return {
        uuid: 'run-1',
        status: 'running',
        trigger: 'manual',
        summary: null,
        actions_taken: [],
        tokens_used: 0,
        iterations: 0,
        duration_seconds: null,
        started_at: null,
        finished_at: null,
        created_at: '2026-07-14T00:00:00Z',
        logs: null,
        ...overrides,
    };
}

describe('isTerminalAgentRunStatus', () => {
    it('returns true for completed and failed', () => {
        expect(isTerminalAgentRunStatus('completed')).toBe(true);
        expect(isTerminalAgentRunStatus('failed')).toBe(true);
    });

    it('returns false for in-flight statuses', () => {
        expect(isTerminalAgentRunStatus('running')).toBe(false);
        expect(isTerminalAgentRunStatus('pending')).toBe(false);
    });
});

describe('parseLastAgentLogLine', () => {
    it('returns null for empty logs', () => {
        expect(parseLastAgentLogLine(null)).toBeNull();
        expect(parseLastAgentLogLine('   ')).toBeNull();
    });

    it('returns the last non-empty line without timestamp prefix', () => {
        const logs = '[10:00:01] Première ligne\n[10:00:02] Analyse du build webhook';
        expect(parseLastAgentLogLine(logs)).toBe('Analyse du build webhook');
    });

    it('truncates long lines', () => {
        const longLine = 'x'.repeat(200);
        const parsed = parseLastAgentLogLine(longLine, 50);
        expect(parsed).toHaveLength(50);
        expect(parsed?.endsWith('…')).toBe(true);
    });
});

describe('agentRunProgressLabel', () => {
    it('returns null when run is missing', () => {
        expect(agentRunProgressLabel(null)).toBeNull();
    });

    it('shows iteration count while running', () => {
        expect(agentRunProgressLabel(makeRun({ iterations: 3 }))).toBe('Itération #3…');
    });

    it('shows startup label before first iteration', () => {
        expect(agentRunProgressLabel(makeRun())).toBe('Démarrage de l\'agent…');
    });

    it('shows summary when completed', () => {
        expect(agentRunProgressLabel(makeRun({
            status: 'completed',
            summary: 'Build analysé.',
        }))).toBe('Build analysé.');
    });

    it('shows failure summary when failed', () => {
        expect(agentRunProgressLabel(makeRun({
            status: 'failed',
            summary: 'Quota dépassé.',
        }))).toBe('Quota dépassé.');
    });
});
