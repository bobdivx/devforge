import { describe, expect, it } from 'vitest';
import {
    cleanupPhaseLabel,
    isTerminalCleanupStatus,
    resolveCleanupPhase,
} from '../src/lib/server-cleanup-tracker';

describe('server cleanup tracker', () => {
    it('detects terminal cleanup statuses', () => {
        expect(isTerminalCleanupStatus('success')).toBe(true);
        expect(isTerminalCleanupStatus('failed')).toBe(true);
        expect(isTerminalCleanupStatus('running')).toBe(false);
    });

    it('resolves cleanup phases from execution state', () => {
        expect(resolveCleanupPhase(null)).toBe('queued');
        expect(resolveCleanupPhase({
            id: 1,
            status: 'running',
            message: 'Nettoyage Docker en file d\'attente…',
            cleanup_log: null,
            created_at: null,
            finished_at: null,
        })).toBe('queued');
        expect(resolveCleanupPhase({
            id: 1,
            status: 'running',
            message: 'Nettoyage Docker en cours…',
            cleanup_log: null,
            created_at: null,
            finished_at: null,
        })).toBe('running');
        expect(resolveCleanupPhase({
            id: 1,
            status: 'success',
            message: 'Saved 12% disk space.',
            cleanup_log: null,
            created_at: null,
            finished_at: '2026-07-15T10:00:00Z',
        })).toBe('completed');
    });

    it('provides french phase labels', () => {
        expect(cleanupPhaseLabel('running')).toContain('en cours');
        expect(cleanupPhaseLabel('completed')).toContain('terminé');
    });
});
