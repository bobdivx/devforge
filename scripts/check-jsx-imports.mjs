#!/usr/bin/env node
/**
 * Garde-fou : chaque composant JSX (<HubGrid>, <Modal>…) utilisé dans apps/web/src
 * doit être importé ou déclaré dans le fichier. Sinon le build Astro passe mais la
 * page plante au rendu (`ReferenceError: HubGrid is not defined`).
 */
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'apps/web/src');
const exts = new Set(['.tsx', '.jsx']);
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (exts.has(path.extname(e.name))) files.push(p);
  }
})(root);

const GLOBALS = new Set(['Fragment']);
let failures = 0;
for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  // Sans commentaires ni chaînes simples, pour éviter les faux positifs.
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  const used = new Set();
  for (const m of code.matchAll(/(?<![\w$.])<([A-Z][A-Za-z0-9_]*)(?=[\s/>.])/g)) used.add(m[1]);
  // Ce qui reste une fois les balises JSX retirées : imports, déclarations, paramètres.
  const rest = code.replace(/<\/?[A-Z][A-Za-z0-9_.]*/g, ' ');
  for (const name of used) {
    if (GLOBALS.has(name)) continue;
    const declared = new RegExp(`\\b${name}\\b`).test(rest);
    if (!declared) {
      failures++;
      console.error(`${path.relative(process.cwd(), file)}: <${name}> utilisé sans import ni déclaration`);
    }
  }
}
if (failures) {
  console.error(`\n${failures} composant(s) JSX non importé(s).`);
  process.exit(1);
}
console.log(`OK : ${files.length} fichiers JSX, tous les composants sont importés.`);
