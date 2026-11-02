import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { BookOpen, ChevronRight, FileText, Menu, Search, X } from 'lucide-preact';
import { getToken } from '../../lib/auth';
import {
  searchWiki,
  WIKI_HOME,
  wikiHref,
  type WikiNavSection,
  type WikiSearchEntry,
  type WikiSearchHit,
} from '../../lib/wiki';
import { renderWikiInline, WikiMarkdown } from './WikiMarkdown';

export interface WikiAppProps {
  slug: string;
  title: string;
  markdown: string;
  nav: WikiNavSection[];
  known: string[];
  footer: string;
  embedded: boolean;
}

const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]';

function Logo() {
  return (
    <span class="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M6 21V4.5C6 4.5 8.2 3 11 3c4.2 0 6.5 2.6 6.5 5.5V16M17.5 8.5H21M17.5 12.5H20"
          stroke="currentColor"
          stroke-width="2.4"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </span>
  );
}

/** Liste de navigation (barre latérale bureau et tiroir mobile). */
function NavList({ nav, current, onNavigate }: { nav: WikiNavSection[]; current: string; onNavigate?: () => void }) {
  return (
    <nav aria-label="Pages du wiki" class="space-y-5">
      {nav.map((s) => (
        <div key={s.title}>
          <p class="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-faint)]">
            {s.title}
          </p>
          <ul class="space-y-0.5">
            {s.items.map((it) => {
              const active = it.slug === current;
              return (
                <li key={it.slug}>
                  <a
                    href={wikiHref(it.slug)}
                    aria-current={active ? 'page' : undefined}
                    onClick={onNavigate}
                    class={`flex min-h-10 items-center rounded-lg px-3 py-2 text-sm transition-colors lg:min-h-0 lg:py-1.5 ${FOCUS} ${
                      active
                        ? 'bg-[var(--color-accent-soft)] font-medium text-[var(--color-accent)]'
                        : 'text-[var(--color-ink-muted)] hover:bg-white/5 hover:text-[var(--color-ink)]'
                    }`}
                  >
                    {it.label}
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/** Tuiles d'accueil : une carte par section, une tuile par page. */
function HomeTiles({ nav }: { nav: WikiNavSection[] }) {
  return (
    <div class="mt-10 space-y-8">
      {nav.map((s) => {
        const items = s.items.filter((i) => i.slug !== WIKI_HOME);
        if (!items.length) return null;
        return (
          <section key={s.title} aria-label={s.title}>
            <h2 class="mb-3 text-[13px] font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-faint)]">
              {s.title}
            </h2>
            <div class="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3 xl:grid-cols-4">
              {items.map((it) => (
                <a
                  key={it.slug}
                  href={wikiHref(it.slug)}
                  class={`group flex min-h-[5.5rem] min-w-0 flex-col justify-between gap-3 rounded-2xl bg-[#1c1c1e] p-3.5 ring-1 ring-white/[0.04] transition duration-200 hover:bg-[#252528] hover:ring-white/15 sm:p-4 ${FOCUS}`}
                >
                  <span class="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--color-accent-soft)] text-[var(--color-accent)] transition-transform duration-200 group-hover:scale-105">
                    <FileText size={17} aria-hidden />
                  </span>
                  <span class="flex items-center justify-between gap-1 text-sm font-medium text-[var(--color-ink)] [overflow-wrap:anywhere]">
                    {it.label}
                    <ChevronRight
                      size={15}
                      aria-hidden
                      class="shrink-0 text-[var(--color-ink-faint)] transition-transform group-hover:translate-x-0.5"
                    />
                  </span>
                </a>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** Recherche : index statique chargé à la première frappe (/wiki/search-index.json). */
function useWikiSearch(query: string) {
  const [index, setIndex] = useState<WikiSearchEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const loading = useRef(false);
  useEffect(() => {
    if (!query.trim() || index || loading.current) return;
    loading.current = true;
    fetch('/wiki/search-index.json', { credentials: 'omit' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: WikiSearchEntry[]) => setIndex(Array.isArray(d) ? d : []))
      .catch(() => setFailed(true))
      .finally(() => {
        loading.current = false;
      });
  }, [query, index]);
  const hits: WikiSearchHit[] = useMemo(() => (index ? searchWiki(index, query) : []), [index, query]);
  return { hits, ready: !!index, failed };
}

function SearchResults({ query, onPick }: { query: string; onPick: () => void }) {
  const { hits, ready, failed } = useWikiSearch(query);
  if (query.trim().length < 2) return null;
  return (
    <div class="mt-2 rounded-2xl border border-[var(--color-line)] bg-[var(--color-bg-elevated)] p-2 shadow-[0_18px_50px_rgb(0_0_0/0.45)]">
      {failed ? (
        <p class="px-3 py-2 text-sm text-[var(--color-ink-muted)]">Recherche indisponible.</p>
      ) : !ready ? (
        <p class="px-3 py-2 text-sm text-[var(--color-ink-muted)]">Chargement…</p>
      ) : hits.length === 0 ? (
        <p class="px-3 py-2 text-sm text-[var(--color-ink-muted)]">Aucun résultat pour « {query.trim()} ».</p>
      ) : (
        <ul class="max-h-[60vh] space-y-1 overflow-y-auto" aria-label="Résultats">
          {hits.map((h) => (
            <li key={h.slug}>
              <a
                href={wikiHref(h.slug)}
                onClick={onPick}
                class={`block rounded-xl px-3 py-2.5 transition-colors hover:bg-white/5 ${FOCUS}`}
              >
                <span class="block text-sm font-medium text-[var(--color-ink)]">{h.title}</span>
                <span class="mt-0.5 line-clamp-2 block text-xs leading-5 text-[var(--color-ink-muted)]">
                  {h.snippet}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SearchBox({ onPick }: { onPick?: () => void }) {
  const [q, setQ] = useState('');
  return (
    <div role="search">
      <label class="relative block">
        <span class="sr-only">Rechercher dans le wiki</span>
        <Search
          size={16}
          aria-hidden
          class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-ink-faint)]"
        />
        <input
          type="search"
          value={q}
          onInput={(e) => setQ((e.currentTarget as HTMLInputElement).value)}
          placeholder="Rechercher…"
          autocomplete="off"
          enterkeyhint="search"
          maxLength={80}
          class="h-11 w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] pl-9 pr-3 text-[16px] text-[var(--color-ink)] placeholder:text-[var(--color-ink-faint)] focus:border-[var(--color-accent)]/60 focus:outline-none lg:h-10 lg:text-sm"
        />
      </label>
      <SearchResults
        query={q}
        onPick={() => {
          setQ('');
          onPick?.();
        }}
      />
    </div>
  );
}

export function WikiApp({ slug, title, markdown, nav, known, footer, embedded }: WikiAppProps) {
  const knownSet = useMemo(() => new Set(known), [known]);
  const [drawer, setDrawer] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  // Page inconnue : le serveur renvoie l'accueil du wiki ; on l'annonce au lieu d'une erreur.
  const [missing, setMissing] = useState<string | null>(null);

  useEffect(() => {
    setSignedIn(!!getToken());
    if (slug !== WIKI_HOME) return;
    const path = decodeURIComponent(window.location.pathname).replace(/\/+$/, '');
    const m = path.match(/^\/wiki\/([^/]+)$/);
    if (m && m[1] !== WIKI_HOME && m[1] !== 'index.html') setMissing(m[1].slice(0, 80));
  }, [slug]);

  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDrawer(false);
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [drawer]);

  const isHome = slug === WIKI_HOME;
  const crumbs = !isHome ? nav.find((s) => s.items.some((i) => i.slug === slug))?.title : undefined;

  return (
    <div class="df-wiki min-h-screen">
      <header class="sticky top-0 z-30 border-b border-[var(--color-line)] bg-[var(--color-bg)]/80 backdrop-blur-xl [padding-top:env(safe-area-inset-top)]">
        <div class="mx-auto flex h-14 max-w-7xl items-center gap-2 px-3 sm:px-6">
          <button
            type="button"
            class={`inline-flex h-11 w-11 items-center justify-center rounded-lg text-[var(--color-ink-muted)] hover:bg-white/5 hover:text-[var(--color-ink)] lg:hidden ${FOCUS}`}
            aria-label="Ouvrir le sommaire"
            aria-expanded={drawer}
            aria-controls="wiki-drawer"
            onClick={() => setDrawer(true)}
          >
            <Menu size={19} aria-hidden />
          </button>
          <a href="/" class={`flex items-center gap-2.5 rounded-lg ${FOCUS}`}>
            <Logo />
            <span class="text-[15px] font-semibold tracking-tight">DevForge</span>
          </a>
          <span class="text-[var(--color-ink-faint)]" aria-hidden>
            /
          </span>
          <a href="/wiki/" class={`rounded-lg text-[15px] font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] ${FOCUS}`}>
            Wiki
          </a>
          <div class="ml-auto flex items-center gap-2">
            <a
              href={signedIn ? '/app' : '/login'}
              class={`inline-flex h-11 items-center rounded-xl bg-[var(--color-accent)] px-4 text-sm font-medium text-zinc-950 hover:brightness-110 lg:h-9 ${FOCUS}`}
            >
              {signedIn ? 'Ouvrir l’app' : 'Connexion'}
            </a>
          </div>
        </div>
      </header>

      {drawer && (
        <div class="fixed inset-0 z-40 lg:hidden" id="wiki-drawer" role="dialog" aria-modal="true" aria-label="Sommaire">
          <button
            type="button"
            class="absolute inset-0 bg-black/60"
            aria-label="Fermer le sommaire"
            onClick={() => setDrawer(false)}
          />
          <div class="absolute inset-y-0 left-0 flex w-[86%] max-w-xs flex-col border-r border-[var(--color-line)] bg-[var(--color-bg-elevated)] [padding-top:env(safe-area-inset-top)]">
            <div class="flex h-14 items-center justify-between px-4">
              <span class="flex items-center gap-2 text-sm font-semibold">
                <BookOpen size={16} aria-hidden class="text-[var(--color-accent)]" />
                Sommaire
              </span>
              <button
                type="button"
                class={`inline-flex h-11 w-11 items-center justify-center rounded-lg text-[var(--color-ink-muted)] hover:bg-white/5 ${FOCUS}`}
                aria-label="Fermer"
                onClick={() => setDrawer(false)}
              >
                <X size={19} aria-hidden />
              </button>
            </div>
            <div class="px-3 pb-3">
              <SearchBox onPick={() => setDrawer(false)} />
            </div>
            <div class="flex-1 overflow-y-auto px-1 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
              <NavList nav={nav} current={slug} onNavigate={() => setDrawer(false)} />
            </div>
          </div>
        </div>
      )}

      <div class="mx-auto flex max-w-7xl gap-8 px-3 sm:px-6">
        <aside class="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-64 shrink-0 overflow-y-auto py-6 pr-2 lg:block">
          <div class="mb-5">
            <SearchBox />
          </div>
          <NavList nav={nav} current={slug} />
        </aside>

        <main class="min-w-0 flex-1 py-5 sm:py-8">
          <div class="mb-4 lg:hidden">
            <SearchBox />
          </div>
          {!embedded && (
            <p class="mb-4 rounded-xl border border-[var(--color-warn)]/30 bg-[var(--color-warn)]/10 px-4 py-3 text-sm text-[var(--color-ink)]">
              Contenu minimal : la documentation n’a pas été embarquée dans cette version.
            </p>
          )}
          {missing && (
            <div class="mb-6 rounded-2xl border border-[var(--color-line-strong)] bg-[var(--color-surface)] p-4 sm:p-5">
              <p class="font-medium text-[var(--color-ink)]">La page « {missing} » n’existe pas (encore).</p>
              <p class="mt-1 text-sm text-[var(--color-ink-muted)]">
                Voici l’accueil du wiki : choisis une page ci-dessous ou utilise la recherche.
              </p>
            </div>
          )}
          <article class="rounded-2xl border border-[var(--color-line)] bg-[var(--color-card)]/80 px-4 py-5 sm:px-8 sm:py-8">
            {crumbs && (
              <p class="mb-2 text-xs font-medium uppercase tracking-[0.08em] text-[var(--color-ink-faint)]">
                <a href="/wiki/" class="hover:text-[var(--color-ink)]">
                  Wiki
                </a>{' '}
                · {crumbs}
              </p>
            )}
            {!/^\s*#\s/.test(markdown) && (
              <h1 class="text-2xl font-semibold tracking-tight text-[var(--color-ink)] sm:text-3xl">{title}</h1>
            )}
            <WikiMarkdown text={markdown} known={knownSet} />
            {isHome && <HomeTiles nav={nav} />}
          </article>
          <footer class="mt-6 flex flex-wrap items-center justify-between gap-3 px-1 pb-[max(2rem,env(safe-area-inset-bottom))] text-xs text-[var(--color-ink-faint)]">
            <span>{renderWikiInline(footer.replace(/\s+/g, ' ').trim(), { known: knownSet }, 'ft')}</span>
            <span>Lecture seule · accessible sans connexion</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
