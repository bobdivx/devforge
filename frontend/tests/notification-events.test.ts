import { describe, expect, it } from 'vitest';
import { notificationEventLabel, sortedNotificationEventKeys } from '../src/lib/notification-events';

describe('libellés événements notification', () => {
    it('traduit les clés connues', () => {
        expect(notificationEventLabel('deployment_failure_discord_notifications')).toBe('Échec de déploiement');
        expect(notificationEventLabel('traefik_outdated_email_notifications')).toBe('Traefik obsolète');
    });

    it('trie les événements par libellé français', () => {
        const keys = sortedNotificationEventKeys({
            server_unreachable_discord_notifications: true,
            deployment_success_discord_notifications: true,
            backup_failure_discord_notifications: true,
        });

        expect(keys).toHaveLength(3);
        expect(keys).toContain('deployment_success_discord_notifications');
        expect(keys.indexOf('backup_failure_discord_notifications')).toBeLessThan(
            keys.indexOf('server_unreachable_discord_notifications'),
        );
    });
});
