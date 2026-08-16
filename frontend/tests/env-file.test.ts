import { describe, expect, it } from 'vitest';
import { normalizeEnvFileContents } from '../src/lib/env-file';

describe('normalizeEnvFileContents', () => {
    it('normalise BOM, export, CRLF et espaces autour de =', () => {
        const input = '\uFEFFexport TURSO_DATABASE_URL = libsql://example.turso.io\r\nJWT_SECRET="super secret"\r\nSITE_LOGIN_REQUIRED: true\n';

        expect(normalizeEnvFileContents(input)).toBe([
            'TURSO_DATABASE_URL=libsql://example.turso.io',
            'JWT_SECRET="super secret"',
            'SITE_LOGIN_REQUIRED=true',
            '',
        ].join('\n'));
    });

    it('retire les octets nuls d’un UTF-16 mal lu', () => {
        const input = 'T\u0000U\u0000R\u0000S\u0000O\u0000=\u0000x\u0000';

        expect(normalizeEnvFileContents(input)).toBe('TURSO=x');
    });
});
