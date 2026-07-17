import { describe, expect, it } from 'vitest';
import {
    formatLibsqlImportBytes,
    isLibsqlImportLarge,
    LIBSQL_IMPORT_MAX_BYTES,
    LIBSQL_IMPORT_WARN_BYTES,
    libsqlImportLargeWarning,
    libsqlImportSizeError,
} from '../src/lib/libsql-import-limits';

describe('libsql-import-limits', () => {
    it('détecte les gros fichiers au seuil soft', () => {
        expect(isLibsqlImportLarge(LIBSQL_IMPORT_WARN_BYTES)).toBe(true);
        expect(isLibsqlImportLarge(1024)).toBe(false);
    });

    it('rejette les fichiers au-delà de la limite dure', () => {
        expect(libsqlImportSizeError(LIBSQL_IMPORT_MAX_BYTES + 1)).toContain('trop volumineux');
        expect(libsqlImportSizeError(1024)).toBeNull();
    });

    it('formate la taille et le warning downtime', () => {
        expect(formatLibsqlImportBytes(2048)).toContain('Ko');
        expect(libsqlImportLargeWarning(LIBSQL_IMPORT_WARN_BYTES)).toContain('arrête temporairement');
    });
});
