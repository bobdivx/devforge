import { Button } from '../ui';

export function SiteHeader() {
  return (
    <header class="sticky top-0 z-30 border-b border-[var(--color-line)] bg-[var(--color-bg)]/70 backdrop-blur-xl">
      <div class="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
        <a href="/" class="flex items-center gap-2.5">
          <span class="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M13 2 4 14h7l-1 8 10-14h-7l1-6z" />
            </svg>
          </span>
          <span class="text-[15px] font-semibold tracking-tight">DevForge</span>
        </a>
        <nav class="hidden items-center gap-7 text-sm text-[var(--color-ink-muted)] md:flex">
          <a class="hover:text-[var(--color-ink)]" href="/#features">
            Produit
          </a>
          <a class="hover:text-[var(--color-ink)]" href="/#metrics">
            Metrics
          </a>
          <a class="hover:text-[var(--color-ink)]" href="/#workflow">
            Workflow
          </a>
        </nav>
        <div class="flex items-center gap-2">
          <Button href="/login" variant="ghost" size="sm" class="hidden sm:inline-flex">
            Log in
          </Button>
          <Button href="/login" size="sm">
            Commencer
          </Button>
        </div>
      </div>
    </header>
  );
}
