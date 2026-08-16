import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEVFORGE_BRAND_NAME, DEVFORGE_FAVICON_URL, DEVFORGE_LOGO_URL } from '../src/lib/brand';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('identité visuelle DevForge', () => {
    it('expose le logo public Laravel', () => {
        expect(DEVFORGE_LOGO_URL).toBe('/devforge/brand/logo.png');
        expect(DEVFORGE_FAVICON_URL).toBe('/devforge/favicon.ico');
        expect(DEVFORGE_BRAND_NAME).toBe('DevForge');
    });

    it('publie favicon.ico à la racine SPA et Laravel', () => {
        expect(existsSync(join(repoRoot, 'frontend/public/favicon.ico'))).toBe(true);
        expect(existsSync(join(repoRoot, 'backend/public/favicon.ico'))).toBe(true);
    });

    it('sert /favicon.ico via nginx au lieu d’un 404 regex .ico', () => {
        const webNginx = readFileSync(join(repoRoot, 'docker/devforge-web/nginx.conf'), 'utf8');
        const proxyNginx = readFileSync(join(repoRoot, 'docker/devforge-proxy/nginx.conf'), 'utf8');

        expect(webNginx).toContain('location = /favicon.ico');
        expect(webNginx).toContain('try_files /favicon.ico /brand/logo.png =404');
        expect(webNginx).toContain('absolute_redirect off');
        expect(webNginx).toContain('try_files $uri $uri/index.html /index.html');
        expect(proxyNginx).toContain('location = /favicon.ico');
        expect(proxyNginx).toContain('proxy_pass http://devforge_web/brand/logo.png');
        expect(proxyNginx).toContain('absolute_redirect off');
        expect(proxyNginx).toContain('proxy_redirect ~^https?://[^/]+(/.*)$ $1');
        expect(proxyNginx).toContain('|mcp|webhooks)(/|$)');
    });
});
