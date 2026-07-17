import { describe, expect, it } from 'vitest';
import { cleanupFreedNoSpace, criticalDiskHints } from '../src/lib/storage-cleanup-hints';

describe('storage cleanup hints', () => {
    it('detects cleanups that did not reduce disk usage', () => {
        expect(cleanupFreedNoSpace(
            'Manual Docker cleanup job executed successfully. Disk usage before: 100%, Disk usage after: 100%.',
        )).toBe(true);
        expect(cleanupFreedNoSpace(
            'Saved 12% disk space. Disk usage before: 95%, Disk usage after: 83%.',
        )).toBe(false);
    });

    it('returns hints only for critical disk usage', () => {
        expect(criticalDiskHints(100).length).toBeGreaterThan(0);
        expect(criticalDiskHints(50)).toEqual([]);
    });
});
