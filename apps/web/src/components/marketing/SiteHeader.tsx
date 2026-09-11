import { useState } from 'preact/hooks';
import { Button } from '../ui';
import { cn } from '../../lib/cn';

const LINKS = [
  { href: '/#features', label: 'Produit' },
  { href: '/#metrics', label: 'Metrics' },
  { href: '/#workflow', label: 'Workflow' },
] as const;

export function SiteHeader() {
  const [open, setOpen] = useState(false);

  return (
    <header class="sticky top-0 z-30 border-b border-[var(--color-line)] bg-[var(--color-bg)]/70 backdrop-blur-xl">
      <div class="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
        <a href="/" class="flex items-center gap-2.5">
          <span class="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M13 2 4 14h7l-1 8 10-14h-7l1-6z" />
            </svg>
          </span>
          <span class="text-[15px] font-semibold tracking-tight">DevForge</span>
        </a>
        <nav class="hidden items-center gap-7 text-sm text-[var(--color-ink-muted)] md:flex">
          {LINKS.map((l) => (
            <a key={l.href} class="hover:text-[var(--color-ink)]" href={l.href}>
              {l.label}
            </a>
          ))}
        </nav>
        <div class="flex items-center gap-2">
          <Button href="/login" variant="ghost" size="sm" class="hidden sm:inline-flex">
            Log in
          </Button>
          <Button href="/login" size="sm">
            Commencer
          </Button>
          <button
            type="button"
            class="inline-flex h-9 w-9 items-center justify-center rounded-lg text-[var(--color-ink-muted)] hover:bg-white/5 hover:text-[var(--color-ink)] md:hidden"
            aria-expanded={open}
            aria-controls="site-mobile-nav"
            aria-label={open ? 'Fermer le menu' : 'Ouvrir le menu'}
            onClick={() => setOpen((v) => !v)}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden>
              {open ? (
                <path d="M6 6l12 12M18 6L6 18" stroke-linecap="round" />
              ) : (
                <path d="M4 7h16M4 12h16M4 17h16" stroke-linecap="round" />
              )}
            </svg>
          </button>
        </div>
      </div>
      <div
        id="site-mobile-nav"
        class={cn(
          'border-t border-[var(--color-line)] md:hidden',
          open ? 'block' : 'hidden',
        )}
      >
        <nav class="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-3">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              class="rounded-lg px-3 py-2.5 text-sm text-[var(--color-ink-muted)] hover:bg-white/5 hover:text-[var(--color-ink)]"
              onClick={() => setOpen(false)}
            >
              {l.label}
            </a>
          ))}
          <a
            href="/login"
            class="rounded-lg px-3 py-2.5 text-sm text-[var(--color-ink-muted)] hover:bg-white/5 hover:text-[var(--color-ink)] sm:hidden"
            onClick={() => setOpen(false)}
          >
            Log in
          </a>
        </nav>
      </div>
    </header>
  );
}
