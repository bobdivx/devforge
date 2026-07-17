import { describe, expect, it } from 'vitest';
import {
    outcomeLabel,
    outcomeToneClass,
    shortSha,
    shouldCollapsePreviousFailures,
} from '../src/lib/agent-correction-summary';

describe('agent-correction-summary helpers', () => {
    it('collapse always previous failures when count > 0', () => {
        expect(shouldCollapsePreviousFailures(1)).toBe(true);
        expect(shouldCollapsePreviousFailures(0)).toBe(false);
        expect(shouldCollapsePreviousFailures(5, false)).toBe(true);
        expect(shouldCollapsePreviousFailures(2, false)).toBe(false);
    });

    it('labels outcomes in French', () => {
        expect(outcomeLabel('fixed')).toBe('Corrigé');
        expect(outcomeLabel('redeploy_only')).toBe('Redeploy seul');
        expect(outcomeLabel('no_action')).toBe('Aucune action');
    });

    it('provides tone classes and short sha', () => {
        expect(outcomeToneClass('fixed')).toContain('success');
        expect(outcomeToneClass('failed')).toContain('error');
        expect(shortSha('abcdef0123456789')).toBe('abcdef0');
        expect(shortSha(null)).toBeNull();
    });
});
