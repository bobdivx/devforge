import { describe, expect, it } from 'vitest';
import {
    extractDestinationUuid,
    extractServerUuid,
    extractTagName,
    parseServerSection,
    serverLegacyPath,
} from '../src/lib/server-sections';

describe('sections serveur et ressources', () => {
    it('extrait l’uuid serveur et la section depuis les routes legacy', () => {
        expect(extractServerUuid('/server/server-uuid')).toBe('server-uuid');
        expect(extractServerUuid('/server/server-uuid/proxy/logs')).toBe('server-uuid');
        expect(parseServerSection('/server/server-uuid/proxy')).toBe('proxy');
        expect(parseServerSection('/server/server-uuid/security/patches')).toBe('security-patches');
        expect(serverLegacyPath('server-uuid', 'metrics')).toBe('/server/server-uuid/metrics');
    });

    it('extrait les identifiants destination et tag', () => {
        expect(extractDestinationUuid('/destination/dest-uuid/resources')).toBe('dest-uuid');
        expect(extractTagName('/tags/production')).toBe('production');
    });
});
