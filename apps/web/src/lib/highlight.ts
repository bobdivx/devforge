/**
 * Coloration syntaxique différée (P5-01) : `shiki` n'est chargé qu'au premier bloc de code
 * d'une langue connue ; les langues se chargent à la demande. Rendu en jetons (pas d'innerHTML).
 */
export type CodeToken = { content: string; color?: string; fontStyle?: number };

export const HIGHLIGHT_THEME = 'github-dark-dimmed';
/** Au-delà, texte brut (coût CPU et mémoire). */
export const HIGHLIGHT_MAX_CHARS = 20_000;

const ALIASES: Record<string, string> = {
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  console: 'bash',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  yml: 'yaml',
  rs: 'rust',
  py: 'python',
  md: 'markdown',
  dockerfile: 'docker',
  'c++': 'cpp',
  kt: 'kotlin',
  text: '',
  txt: '',
  plain: '',
};

export function normalizeLang(lang?: string): string {
  const l = (lang ?? '').trim().toLowerCase();
  return l in ALIASES ? ALIASES[l] : l;
}

type Highlighter = {
  loadLanguage: (...langs: string[]) => Promise<void>;
  codeToTokensBase: (code: string, opts: { lang: string; theme: string }) => CodeToken[][];
};

let highlighter: Promise<Highlighter> | null = null;
const loaded = new Set<string>();
const failed = new Set<string>();

export async function highlightCode(code: string, lang?: string): Promise<CodeToken[][] | null> {
  const l = normalizeLang(lang);
  if (!l || failed.has(l) || code.length > HIGHLIGHT_MAX_CHARS) return null;
  try {
    const shiki = await import('shiki');
    if (!(l in shiki.bundledLanguages)) {
      failed.add(l);
      return null;
    }
    highlighter ??= shiki.getSingletonHighlighter({ themes: [HIGHLIGHT_THEME], langs: [] }) as unknown as Promise<Highlighter>;
    const h = await highlighter;
    if (!loaded.has(l)) {
      await h.loadLanguage(l);
      loaded.add(l);
    }
    return h.codeToTokensBase(code, { lang: l, theme: HIGHLIGHT_THEME });
  } catch {
    failed.add(l);
    return null;
  }
}
