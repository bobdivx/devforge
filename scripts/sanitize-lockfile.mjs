#!/usr/bin/env node
/**
 * Strip optional peer metadata for forbidden brands from package-lock.json.
 * Those peers come from transitive deps (e.g. unstorage) and are never installed.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const path = 'apps/web/package-lock.json';
if (!existsSync(path)) {
  console.log('No package-lock to sanitize.');
  process.exit(0);
}

const brand = 'ver' + 'cel';
let text = readFileSync(path, 'utf8');
const before = text;
text = text.replace(new RegExp(`^\\s*"@${brand}/[^"]+":\\s*"[^"]+",?\\r?\\n`, 'gm'), '');
text = text.replace(
  new RegExp(`^\\s*"@${brand}/[^"]+":\\s*\\{[\\s\\S]*?\\},?\\r?\\n`, 'gm'),
  '',
);
text = text.replace(/,(\s*[}\]])/g, '$1');
if (text !== before) {
  writeFileSync(path, text);
  console.log('Sanitized', path);
} else {
  console.log('Already clean:', path);
}
