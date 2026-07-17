import { describe, expect, it } from 'vitest';

function serverUuidOf(configuration: Record<string, unknown>): string | null {
    const server = configuration.server;
    if (server && typeof server === 'object' && 'uuid' in server) {
        return String((server as { uuid?: string }).uuid ?? '') || null;
    }

    return null;
}

describe('ServerResourcesPanel helpers', () => {
    it('extrait l’uuid serveur depuis la configuration core', () => {
        expect(serverUuidOf({ server: { uuid: 'srv-1', name: 'NAS' } })).toBe('srv-1');
        expect(serverUuidOf({})).toBeNull();
        expect(serverUuidOf({ server: 'bad' })).toBeNull();
    });
});
