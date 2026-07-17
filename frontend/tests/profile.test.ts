import { describe, expect, it } from 'vitest';
import {
    applyAppearance,
    contentWidthClass,
    getAppearancePreferences,
} from '../src/lib/appearance';
import { parseProfileTab, profileTabPath } from '../src/lib/profile-tabs';

describe('profil DevForge', () => {
    it('mappe les routes profil et apparence', () => {
        expect(parseProfileTab('/profile')).toBe('account');
        expect(parseProfileTab('/profile/appearance')).toBe('appearance');
        expect(profileTabPath('appearance')).toBe('/profile/appearance');
    });

    it('persiste les préférences d’apparence', () => {
        applyAppearance({ theme: 'dark', pageWidth: 'center', zoom: '90' });
        expect(getAppearancePreferences()).toEqual({
            theme: 'dark',
            pageWidth: 'center',
            zoom: '90',
        });
        expect(contentWidthClass('center')).toBe('max-w-5xl');
    });
});
