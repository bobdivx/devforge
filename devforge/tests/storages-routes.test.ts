import { describe, expect, it } from 'vitest';
import { extractStorageUuid, storageShowsResources } from '../src/lib/routing/storages-routes';

describe('routes stockage S3', () => {
    it('extrait l’uuid et détecte la page ressources', () => {
        expect(extractStorageUuid('/storages/abc-uuid')).toBe('abc-uuid');
        expect(extractStorageUuid('/storages/abc-uuid/resources')).toBe('abc-uuid');
        expect(storageShowsResources('/storages/abc-uuid/resources')).toBe(true);
        expect(storageShowsResources('/storages/abc-uuid')).toBe(false);
    });
});
