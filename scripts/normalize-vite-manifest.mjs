#!/usr/bin/env node
/**
 * Docker monorepo builds sometimes emit Vite manifest keys as
 * `backend/resources/...` while Blade uses `@vite(['resources/...'])`.
 * Strip a leading `backend/` so keys match Laravel conventions.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(root, 'backend/public/build/manifest.json');

if (!fs.existsSync(manifestPath)) {
    console.error(`normalize-vite-manifest: missing ${manifestPath}`);
    process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const normalized = {};
let changed = 0;

for (const [key, value] of Object.entries(manifest)) {
    const nextKey = key.startsWith('backend/') ? key.slice('backend/'.length) : key;
    const entry = { ...value };

    if (typeof entry.src === 'string' && entry.src.startsWith('backend/')) {
        entry.src = entry.src.slice('backend/'.length);
    }

    if (nextKey !== key) {
        changed += 1;
    }

    normalized[nextKey] = entry;
}

if (changed > 0) {
    fs.writeFileSync(manifestPath, `${JSON.stringify(normalized, null, 2)}\n`);
    console.log(`normalize-vite-manifest: rewrote ${changed} key(s)`);
} else {
    console.log('normalize-vite-manifest: already aligned');
}
