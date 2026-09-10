import { Container } from '../ui';

export function SiteFooter() {
  return (
    <footer class="border-t border-[var(--color-line)] py-12">
      <Container class="flex flex-wrap items-center justify-between gap-4 text-sm text-[var(--color-ink-muted)]">
        <span class="font-medium text-[var(--color-ink)]">DevForge</span>
        <div class="flex gap-5">
          <a class="hover:text-[var(--color-ink)]" href="/app">
            App
          </a>
          <a
            class="hover:text-[var(--color-ink)]"
            href="https://github.com/bobdivx/devforge"
            rel="noreferrer"
            target="_blank"
          >
            GitHub
          </a>
        </div>
      </Container>
    </footer>
  );
}
