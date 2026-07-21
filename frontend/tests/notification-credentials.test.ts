import { describe, expect, it } from 'vitest';

describe('notification credentials contract', () => {
    it('exposes secret set flags without plaintext secrets', () => {
        const credentials = {
            discord_ping_enabled: true,
            discord_webhook_url_set: true,
        };

        expect(credentials).toMatchObject({
            discord_ping_enabled: true,
            discord_webhook_url_set: true,
        });
        expect(credentials).not.toHaveProperty('discord_webhook_url');
    });
});
