/*
 * Lecture du dossier `wiki/` du dépôt — **au build uniquement** (frontmatter Astro,
 * getStaticPaths). Rien de ce module n'est livré au navigateur.
 *
 * Emplacements essayés : DEVFORGE_WIKI_DIR, puis `../../wiki` depuis apps/web
 * (dépôt) ou depuis /web (image Docker : `COPY wiki/ /wiki/`). Dossier absent →
 * accueil minimal (`ensureHome`), jamais d'échec de build.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  completeNav,
  ensureHome,
  isValidSlug,
  pageTitle,
  parseSidebar,
  WIKI_REPO_URL,
  type WikiData,
  type WikiPage,
} from './wiki';

const MAX_BYTES = 512 * 1024;

function wikiDir(): string | null {
  const candidates = [
    process.env.DEVFORGE_WIKI_DIR,
    resolve(process.cwd(), '../../wiki'),
    resolve(process.cwd(), '../wiki'),
  ].filter((p): p is string => !!p);
  for (const dir of candidates) {
    try {
      if (existsSync(join(dir, 'Home.md')) || (existsSync(dir) && statSync(dir).isDirectory() && hasMd(dir))) {
        return dir;
      }
    } catch {
      /* suivant */
    }
  }
  return null;
}

function hasMd(dir: string): boolean {
  return readdirSync(dir).some((f: string) => f.endsWith('.md'));
}

function readSmall(path: string): string | null {
  try {
    const st = statSync(path);
    if (!st.isFile() || st.size > MAX_BYTES) return null;
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

let cache: WikiData | null = null;

export function loadWiki(): WikiData {
  if (cache) return cache;
  const dir = wikiDir();
  const pages: WikiPage[] = [];
  let sidebar = '';
  let footer = '';
  if (dir) {
    for (const file of readdirSync(dir).sort()) {
      if (!file.endsWith('.md')) continue;
      const slug = file.slice(0, -3);
      if (slug === '_Sidebar') sidebar = readSmall(join(dir, file)) ?? '';
      else if (slug === '_Footer') footer = readSmall(join(dir, file)) ?? '';
      // README : note interne au dossier (synchro GitHub Wiki), pas une page.
      if (slug === 'README' || !isValidSlug(slug)) continue;
      const markdown = readSmall(join(dir, file));
      if (markdown === null) continue;
      pages.push({ slug, title: pageTitle(markdown, slug), markdown });
    }
  }
  const embedded = pages.length > 0;
  const all = ensureHome(pages);
  const known = new Set(all.map((p) => p.slug));
  const nav = completeNav(parseSidebar(sidebar, known), all);
  cache = {
    pages: all,
    nav,
    footer: footer.trim() || `[DevForge](${WIKI_REPO_URL})`,
    embedded,
  };
  return cache;
}
