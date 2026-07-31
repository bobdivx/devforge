import { describe, expect, it } from 'vitest';
import {
    agentRunProgressLabel,
    isInFlightAgentRunStatus,
    isTerminalAgentRunStatus,
    parseLastAgentLogLine,
    shouldTrackAgentLatestRun,
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
    it('returns true for completed, failed and awaiting_approval', () => {
        expect(isTerminalAgentRunStatus('completed')).toBe(true);
        expect(isTerminalAgentRunStatus('failed')).toBe(true);
        expect(isTerminalAgentRunStatus('awaiting_approval')).toBe(true);
    });

    it('returns false for in-flight statuses', () => {
        expect(isTerminalAgentRunStatus('running')).toBe(false);
        expect(isTerminalAgentRunStatus('pending')).toBe(false);
    });
});

describe('isInFlightAgentRunStatus', () => {
    it('detects pending, running and waiting_for_subagents', () => {
        expect(isInFlightAgentRunStatus('pending')).toBe(true);
        expect(isInFlightAgentRunStatus('running')).toBe(true);
        expect(isInFlightAgentRunStatus('waiting_for_subagents')).toBe(true);
        expect(isInFlightAgentRunStatus('completed')).toBe(false);
        expect(isInFlightAgentRunStatus('failed')).toBe(false);
    });
});

describe('shouldTrackAgentLatestRun', () => {
    it('tracks only when agent is running and latest run is still in flight', () => {
        expect(shouldTrackAgentLatestRun('running', { uuid: 'r1', status: 'running' }, false)).toBe(true);
        expect(shouldTrackAgentLatestRun('running', { uuid: 'r1', status: 'pending' }, false)).toBe(true);
    });

    it('does not re-track a finished run while agent status is still stale running', () => {
        expect(shouldTrackAgentLatestRun('running', { uuid: 'r1', status: 'completed' }, false)).toBe(false);
        expect(shouldTrackAgentLatestRun('running', { uuid: 'r1', status: 'failed' }, false)).toBe(false);
    });

    it('skips when already tracking or agent is idle', () => {
        expect(shouldTrackAgentLatestRun('running', { uuid: 'r1', status: 'running' }, true)).toBe(false);
        expect(shouldTrackAgentLatestRun('idle', { uuid: 'r1', status: 'running' }, false)).toBe(false);
        expect(shouldTrackAgentLatestRun('running', null, false)).toBe(false);
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
