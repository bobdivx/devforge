#!/usr/bin/env node
/**
 * Smoke test for normalize-vite-manifest.mjs (no Vite build required).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const script = path.join(here, 'normalize-vite-manifest.mjs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vite-manifest-'));
const buildDir = path.join(tmp, 'backend', 'public', 'build');
fs.mkdirSync(buildDir, { recursive: true });

const dirty = {
    'backend/resources/js/app.js': {
        file: 'assets/app.js',
        src: 'backend/resources/js/app.js',
        isEntry: true,
    },
    'backend/resources/css/app.css': {
        file: 'assets/app.css',
        src: 'backend/resources/css/app.css',
        isEntry: true,
    },
};
fs.writeFileSync(path.join(buildDir, 'manifest.json'), `${JSON.stringify(dirty, null, 2)}\n`);

// Patch script to read from tmp by running via cwd override: copy script behavior by
// temporarily replacing expected path through a symlink tree matching repo layout.
const fakeRoot = tmp;
const linkedScript = path.join(fakeRoot, 'scripts', 'normalize-vite-manifest.mjs');
fs.mkdirSync(path.dirname(linkedScript), { recursive: true });
fs.copyFileSync(script, linkedScript);

const result = spawnSync(process.execPath, [linkedScript], {
    cwd: fakeRoot,
    encoding: 'utf8',
});

if (result.status !== 0) {
    console.error(result.stdout, result.stderr);
    process.exit(result.status ?? 1);
}

const normalized = JSON.parse(fs.readFileSync(path.join(buildDir, 'manifest.json'), 'utf8'));
const keys = Object.keys(normalized);

if (!keys.includes('resources/js/app.js') || !keys.includes('resources/css/app.css')) {
    console.error('expected normalized keys, got:', keys);
    process.exit(1);
}
if (keys.some((k) => k.startsWith('backend/'))) {
    console.error('backend/ prefix still present:', keys);
    process.exit(1);
}
if (normalized['resources/js/app.js'].src !== 'resources/js/app.js') {
    console.error('src not stripped:', normalized['resources/js/app.js']);
    process.exit(1);
}

console.log('normalize-vite-manifest.test: ok');
fs.rmSync(tmp, { recursive: true, force: true });

// Also assert real script path resolves under repo when invoked normally with a fixture
// already covered above via copied script.
void repoRoot;
