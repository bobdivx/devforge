/*
 * Wiki public DevForge : données et règles pures (testables, sans fs).
 *
 * Le contenu vient des fichiers `wiki/*.md` du dépôt, lus au **build** (voir
 * `wiki-source.ts`) et figés en pages statiques : aucun accès disque ni paramètre
 * de chemin à l'exécution. Les slugs sont une liste blanche connue au build.
 */

export interface WikiPage {
  slug: string;
  title: string;
  markdown: string;
}

export interface WikiNavItem {
  label: string;
  slug: string;
}

export interface WikiNavSection {
  title: string;
  items: WikiNavItem[];
}

export interface WikiData {
  pages: WikiPage[];
  nav: WikiNavSection[];
  footer: string;
  /** false : aucun fichier wiki trouvé au build → contenu minimal de secours. */
  embedded: boolean;
}

export interface WikiSearchEntry {
  slug: string;
  title: string;
  text: string;
}

export const WIKI_HOME = 'Home';
export const WIKI_REPO_URL = 'https://github.com/bobdivx/devforge';

/** Nom de fichier → slug : lettres, chiffres, tirets. Pas de `.`, `/`, `\`, `_` initial. */
const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,79}$/;

export function isValidSlug(slug: string): boolean {
  return SLUG_RE.test(slug);
}

/** URL publique d'une page (format répertoire d'Astro). */
export function wikiHref(slug: string, anchor?: string): string {
  const base = slug === WIKI_HOME ? '/wiki/' : `/wiki/${slug}/`;
  return anchor ? `${base}#${anchor}` : base;
}

/** Ancre d'un titre : minuscules, sans accents, tirets. */
export function headingId(text: string): string {
  return text
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[`*_~[\]()]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Titre de page : premier `# …`, sinon le slug lisible. */
export function pageTitle(markdown: string, slug: string): string {
  const m = markdown.match(/^\s*#\s+(.+?)\s*#*\s*$/m);
  if (m) return m[1].replace(/[`*_]/g, '').trim();
  return slug.replace(/-/g, ' ');
}

/** `[[Page]]`, `[[Libellé|Page]]`, `[[Page#ancre]]` → { label, slug, anchor }. */
export function parseWikiLink(inner: string): { label: string; slug: string; anchor?: string } {
  const bar = inner.indexOf('|');
  const label = (bar >= 0 ? inner.slice(0, bar) : inner).trim();
  let target = (bar >= 0 ? inner.slice(bar + 1) : inner).trim();
  let anchor: string | undefined;
  const hash = target.indexOf('#');
  if (hash >= 0) {
    anchor = headingId(target.slice(hash + 1)) || undefined;
    target = target.slice(0, hash);
  }
  // GitHub Wiki : espaces = tirets.
  const slug = target.replace(/\s+/g, '-');
  return { label: bar >= 0 ? label : label.split('#')[0].trim(), slug, anchor };
}

export type ResolvedLink =
  | { kind: 'internal'; href: string }
  | { kind: 'external'; href: string }
  | { kind: 'none' };

/** Chemin relatif (depuis `wiki/`) normalisé dans le dépôt ; null s'il en sort. */
function repoPath(rel: string): string | null {
  const parts = ['wiki'];
  for (const seg of rel.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') {
      if (!parts.length) return null;
      parts.pop();
    } else if (/^[\w.@+-]+$/.test(seg)) parts.push(seg);
    else return null;
  }
  return parts.length ? parts.join('/') : null;
}

/**
 * Lien Markdown → cible sûre. Seuls http(s), mailto, ancres et pages connues
 * passent ; `javascript:`, `data:` et autres schémas sont rendus en texte.
 */
export function resolveHref(raw: string, known: ReadonlySet<string>): ResolvedLink {
  const url = raw.trim();
  if (!url) return { kind: 'none' };
  if (/^(https?:\/\/|mailto:)/i.test(url)) return { kind: 'external', href: url };
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('//') || /[\s<>"'\\]/.test(url)) {
    return { kind: 'none' };
  }
  if (url.startsWith('#')) {
    const id = headingId(url.slice(1));
    return id ? { kind: 'internal', href: `#${id}` } : { kind: 'none' };
  }
  const [pathPart, anchorPart] = url.split('#', 2);
  const anchor = anchorPart ? headingId(anchorPart) || undefined : undefined;
  // Page du wiki : `Kubernetes`, `Kubernetes.md`, `./Kubernetes`, `/wiki/Kubernetes`.
  const bare = pathPart
    .replace(/^\.\//, '')
    .replace(/^\/?wiki\//, '')
    .replace(/\/$/, '')
    .replace(/\.md$/i, '');
  if (isValidSlug(bare) && known.has(bare)) return { kind: 'internal', href: wikiHref(bare, anchor) };
  // Fichier du dépôt hors wiki/ (ex. ../deploy/usb/README.md) → GitHub, lecture seule.
  if (!pathPart.startsWith('/')) {
    const p = repoPath(pathPart);
    if (p && p !== 'wiki' && !p.startsWith('wiki/')) {
      return {
        kind: 'external',
        href: `${WIKI_REPO_URL}/blob/main/${p}${anchor ? `#${anchor}` : ''}`,
      };
    }
  }
  return { kind: 'none' };
}

/** `_Sidebar.md` (format GitHub Wiki) → sections de navigation. */
export function parseSidebar(markdown: string, known: ReadonlySet<string>): WikiNavSection[] {
  const sections: WikiNavSection[] = [];
  let current: WikiNavSection | null = null;
  for (const raw of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const head = line.match(/^(?:\*\*(.+?)\*\*|#{1,6}\s+(.+))$/);
    if (head) {
      current = { title: (head[1] ?? head[2]).trim(), items: [] };
      sections.push(current);
      continue;
    }
    const item = line.match(/^[-*+]\s+(.*)$/);
    if (!item) continue;
    const wl = item[1].match(/\[\[([^\]]+)\]\]/);
    let entry: WikiNavItem | null = null;
    if (wl) {
      const p = parseWikiLink(wl[1]);
      entry = { label: p.label, slug: p.slug };
    } else {
      const md = item[1].match(/\[([^\]]+)\]\(([^)]+)\)/);
      if (md) {
        const slug = md[2].trim().replace(/\.md$/i, '').replace(/^\.\//, '');
        entry = { label: md[1].trim(), slug };
      }
    }
    if (!entry || !isValidSlug(entry.slug) || !known.has(entry.slug)) continue;
    if (!current) {
      current = { title: 'Pages', items: [] };
      sections.push(current);
    }
    current.items.push(entry);
  }
  return sections.filter((s) => s.items.length > 0);
}

/** Pages absentes de la barre latérale : regroupées dans « Autres pages ». */
export function completeNav(nav: WikiNavSection[], pages: WikiPage[]): WikiNavSection[] {
  const listed = new Set(nav.flatMap((s) => s.items.map((i) => i.slug)));
  const rest = pages
    .filter((p) => !listed.has(p.slug))
    .sort((a, b) => a.title.localeCompare(b.title, 'fr'))
    .map((p) => ({ label: p.title, slug: p.slug }));
  return rest.length ? [...nav, { title: nav.length ? 'Autres pages' : 'Pages', items: rest }] : nav;
}

/** Texte brut indexable (sans syntaxe Markdown). */
export function plainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[\[([^\]|]+\|)?([^\]]+)\]\]/g, '$2')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/:?-{3,}:?/g, ' ')
    .replace(/[#>*_`|~]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildSearchIndex(pages: WikiPage[]): WikiSearchEntry[] {
  return pages.map((p) => ({ slug: p.slug, title: p.title, text: plainText(p.markdown) }));
}

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

export interface WikiSearchHit {
  slug: string;
  title: string;
  snippet: string;
  score: number;
}

/** Recherche simple : tous les mots doivent apparaître (titre ou texte), insensible aux accents. */
export function searchWiki(index: WikiSearchEntry[], query: string, limit = 12): WikiSearchHit[] {
  const terms = fold(query)
    .split(/\s+/)
    .filter((t) => t.length >= 2)
    .slice(0, 8);
  if (!terms.length) return [];
  const hits: WikiSearchHit[] = [];
  for (const e of index) {
    const title = fold(e.title);
    const text = fold(e.text);
    let score = 0;
    let ok = true;
    for (const t of terms) {
      const inTitle = title.includes(t);
      const inText = text.includes(t);
      if (!inTitle && !inText) {
        ok = false;
        break;
      }
      score += (inTitle ? 10 : 0) + (inText ? 1 : 0);
    }
    if (!ok) continue;
    const at = text.indexOf(terms[0]);
    const start = Math.max(0, at - 50);
    const snippet =
      at >= 0
        ? `${start > 0 ? '…' : ''}${e.text.slice(start, start + 150).trim()}${start + 150 < e.text.length ? '…' : ''}`
        : e.text.slice(0, 150);
    hits.push({ slug: e.slug, title: e.title, snippet, score });
  }
  return hits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, 'fr')).slice(0, limit);
}

/** Accueil minimal quand aucun fichier wiki n'a été embarqué au build. */
export const FALLBACK_HOME = `# Wiki DevForge

La documentation n'a pas été embarquée dans cette version de DevForge.

- Code et documentation source : [bobdivx/devforge](${WIKI_REPO_URL})
- Dossier du wiki : [wiki/](${WIKI_REPO_URL}/tree/main/wiki)
- Versions publiées : [GitHub Releases](${WIKI_REPO_URL}/releases)
`;

/** Données de secours : jamais d'erreur, même si le dossier `wiki/` manque. */
export function ensureHome(pages: WikiPage[]): WikiPage[] {
  if (pages.some((p) => p.slug === WIKI_HOME)) return pages;
  return [{ slug: WIKI_HOME, title: pageTitle(FALLBACK_HOME, WIKI_HOME), markdown: FALLBACK_HOME }, ...pages];
}
