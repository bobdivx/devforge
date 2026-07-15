import { describe, expect, it } from 'vitest';
import { diskUsageLabel, diskUsageTone } from '../src/lib/disk-usage';

describe('diskUsageTone', () => {
    it('retourne neutral quand la mesure est absente', () => {
        expect(diskUsageTone(null, 80, 85)).toBe('neutral');
        expect(diskUsageLabel(null)).toBe('Non mesuré');
    });

    it('escalade warning puis error selon les seuils', () => {
        expect(diskUsageTone(70, 80, 85)).toBe('success');
        expect(diskUsageTone(82, 80, 85)).toBe('warning');
        expect(diskUsageTone(90, 80, 85)).toBe('error');
    });
});
