#!/usr/bin/env node
/**
 * Fail CI if forbidden legacy platform brand names appear in the repo.
 * Brands are assembled at runtime so this file itself stays clean for ripgrep.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { existsSync } from 'node:fs';

const ROOT = process.cwd();
const BRANDS = ['coo' + 'lify', 'ver' + 'cel'];
const FORBIDDEN = new RegExp(`\\b(${BRANDS.join('|')})\\b`, 'i');
const ALLOW_FILES = new Set(['scripts/check-forbidden-names.mjs']);
const SKIP_DIRS = new Set([
  'node_modules',
  'target',
  '.git',
  'dist',
  '.astro',
]);

async function walk(dir, hits) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (SKIP_DIRS.has(ent.name)) continue;
    const full = join(dir, ent.name);
    if (ent.isDirectory()) {
      await walk(full, hits);
      continue;
    }
    if (
      !/\.(md|mdc|rs|ts|tsx|js|mjs|json|yml|yaml|astro|css|toml|sh|env\.example|lock)$/i.test(
        ent.name,
      )
    ) {
      continue;
    }
    const rel = relative(ROOT, full).replace(/\\/g, '/');
    if (ALLOW_FILES.has(rel)) continue;
    let text;
    try {
      text = await readFile(full, 'utf8');
    } catch {
      continue;
    }
    const lines = text.split(/\r?\n/);
    lines.forEach((line, i) => {
      if (FORBIDDEN.test(line)) {
        hits.push(`${rel}:${i + 1}:${line.trim()}`);
      }
    });
  }
}

const hits = [];
if (existsSync(ROOT)) {
  await walk(ROOT, hits);
}

if (hits.length) {
  console.error('FORBIDDEN brand mentions found:\n' + hits.slice(0, 80).join('\n'));
  process.exit(1);
}

console.log('OK: no forbidden brand mentions.');
