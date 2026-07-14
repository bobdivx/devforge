import { describe, expect, it } from 'vitest';
import { sanitizeResourceUuid } from '../src/lib/route-path';

describe('sanitizeResourceUuid', () => {
    it('retire les slashs parasites autour de l’uuid', () => {
        expect(sanitizeResourceUuid('btnfr114ubmua4nvk73y4h6u/')).toBe('btnfr114ubmua4nvk73y4h6u');
        expect(sanitizeResourceUuid('/btnfr114ubmua4nvk73y4h6u/')).toBe('btnfr114ubmua4nvk73y4h6u');
    });

    it('retourne null pour une valeur vide', () => {
        expect(sanitizeResourceUuid(null)).toBeNull();
        expect(sanitizeResourceUuid('   ')).toBeNull();
    });
});
