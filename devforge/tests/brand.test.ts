import { describe, expect, it } from 'vitest';
import { DEVFORGE_BRAND_NAME, DEVFORGE_LOGO_URL } from '../src/lib/brand';

describe('identité visuelle DevForge', () => {
    it('expose le logo public Laravel', () => {
        expect(DEVFORGE_LOGO_URL).toBe('/devforge/brand/logo.png');
        expect(DEVFORGE_BRAND_NAME).toBe('DevForge');
    });
});
