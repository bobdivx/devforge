import { describe, expect, it } from 'vitest';
import {
    groupedVisibleSettingsTabs,
    parseNotificationChannel,
    parseSecuritySection,
    parseSettingsTab,
    visibleSettingsTabs,
} from '../src/lib/settings-tabs';

describe('onglets paramètres DevForge', () => {
    it('masque les onglets instance admin et agents selon les permissions', () => {
        const memberTabs = visibleSettingsTabs(false, false);
        expect(memberTabs.some(({ id }) => id === 'instance')).toBe(false);
        expect(memberTabs.some(({ id }) => id === 'oauth')).toBe(false);
        expect(memberTabs.some(({ id }) => id === 'ai')).toBe(false);
        expect(memberTabs.some(({ id }) => id === 'notifications')).toBe(true);

        const adminTabs = visibleSettingsTabs(true, true);
        expect(adminTabs.some(({ id }) => id === 'instance')).toBe(true);
        expect(adminTabs.some(({ id }) => id === 'scheduled-jobs')).toBe(true);
        expect(adminTabs.some(({ id }) => id === 'ai')).toBe(true);
    });

    it('déduit le canal de notification depuis les routes legacy', () => {
        expect(parseNotificationChannel('/notifications/email')).toBe('email');
        expect(parseNotificationChannel('/notifications/discord')).toBe('discord');
        expect(parseNotificationChannel('/settings/notifications')).toBeNull();
    });

    it('déduit la section sécurité depuis les routes legacy', () => {
        expect(parseSecuritySection('/settings/security')).toBe('keys');
        expect(parseSecuritySection('/security/private-key')).toBe('keys');
        expect(parseSecuritySection('/security/cloud-tokens')).toBe('cloud-tokens');
        expect(parseSecuritySection('/security/cloud-init-scripts')).toBe('cloud-init-scripts');
        expect(parseSecuritySection('/security/api-tokens')).toBe('api-tokens');
    });

    it('mappe le profil vers l’onglet compte', () => {
        expect(parseSettingsTab('/profile/appearance')).toBe('account');
    });

    it('regroupe les onglets paramètres par section', () => {
        const groups = groupedVisibleSettingsTabs(false, false);
        expect(groups.some(({ id }) => id === 'organization')).toBe(true);
        expect(groups.find(({ id }) => id === 'organization')?.tabs.some(({ id }) => id === 'team')).toBe(true);
        expect(groups.some(({ id }) => id === 'instance')).toBe(false);
    });
});
