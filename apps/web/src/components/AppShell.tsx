import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { globalNavForRole, type NavItem } from '../lib/nav';
import { api } from '../lib/api';
import { cn } from '../lib/cn';
import { ToastProvider } from './ui';
import { AuthGate } from './AuthGate';
import { AppHeader } from './AppHeader';

type Props = {
  active?: string;
  children: ComponentChildren;
  /** Sous-nav sidebar (projet, settings…). Alias historique : projectNav. */
  sideNav?: NavItem[];
  sideNavLabel?: string;
  /** @deprecated préférer sideNav */
  projectNav?: NavItem[];
  title?: string;
  description?: string;
  actions?: ComponentChildren;
  skipAuth?: boolean;
};

function sideNavItemActive(item: NavItem): boolean {
  if (typeof window === 'undefined') return false;
  const path = window.location.pathname;
  if (path.startsWith('/app/admin')) return false;
  if (path.startsWith('/app/update')) return item.key === 'update';
  if (path.startsWith('/app/storage')) return item.key === 'backup';
  const tab = new URLSearchParams(window.location.search).get('tab');
  if (tab) return tab === item.key;
  // Settings sans ?tab → Général ; projet sans ?tab → Overview
  return item.key === 'overview' || item.key === 'general';
}

function ShellInner({
  active = 'home',
  children,
  sideNav,
  sideNavLabel = 'Projet',
  projectNav,
  title,
  description,
  actions,
}: Props) {
  const [navItems, setNavItems] = useState(() => globalNavForRole(null));
  const nav = sideNav ?? projectNav;
  const navLabel = sideNav ? sideNavLabel : projectNav ? 'Projet' : sideNavLabel;

  useEffect(() => {
    let cancelled = false;
    api
      .bootstrap()
      .then((b) => {
        if (!cancelled) setNavItems(globalNavForRole(b.user?.role));
      })
      .catch(() => {
        /* AuthGate gère */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <ToastProvider>
      <div class="min-h-screen pb-20 lg:pb-8">
        <div class="mx-auto flex min-h-screen max-w-6xl gap-8 px-4 pt-4 lg:px-6">
          <aside class="hidden w-52 shrink-0 lg:block">
            <a href="/app" class="mb-8 flex items-center gap-2.5">
              <span class="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  <path d="M13 2 4 14h7l-1 8 10-14h-7l1-6z" />
                </svg>
              </span>
              <span class="text-[15px] font-semibold tracking-tight">DevForge</span>
            </a>
            <nav class="flex flex-col gap-0.5">
              {navItems.map((item) => (
                <a
                  key={item.key}
                  href={item.href}
                  class={cn(
                    'rounded-lg px-3 py-2 text-sm transition',
                    active === item.key
                      ? 'bg-[var(--color-accent-soft)] font-medium text-[var(--color-accent)]'
                      : 'text-[var(--color-ink-muted)] hover:bg-white/5 hover:text-[var(--color-ink)]',
                  )}
                >
                  {item.label}
                </a>
              ))}
            </nav>
            {nav && (
              <div class="mt-8">
                <div class="mb-2 px-3 text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--color-ink-faint)]">
                  {navLabel}
                </div>
                <nav class="flex flex-col gap-0.5">
                  {nav.map((item) => {
                    const on = sideNavItemActive(item);
                    return (
                      <a
                        key={item.key}
                        href={item.href}
                        class={cn(
                          'rounded-lg px-3 py-2 text-sm transition',
                          on
                            ? 'bg-white/5 font-medium text-[var(--color-ink)]'
                            : 'text-[var(--color-ink-muted)] hover:bg-white/5 hover:text-[var(--color-ink)]',
                        )}
                      >
                        {item.label}
                      </a>
                    );
                  })}
                </nav>
              </div>
            )}
          </aside>

          <main class="min-w-0 flex-1 py-2">
            <AppHeader />
            {(title || actions) && (
              <div class="mb-6 flex flex-wrap items-end justify-between gap-3">
                <div>
                  {title && (
                    <h1 class="text-2xl font-semibold tracking-tight md:text-3xl">{title}</h1>
                  )}
                  {description && (
                    <p class="mt-2 text-sm text-[var(--color-ink-muted)]">{description}</p>
                  )}
                </div>
                {actions}
              </div>
            )}
            {children}
          </main>
        </div>

        <nav class="fixed inset-x-0 bottom-0 z-20 border-t border-[var(--color-line)] bg-[var(--color-bg)]/95 backdrop-blur lg:hidden">
          <div class="mx-auto flex max-w-lg justify-around px-2 py-2">
            {navItems.map((item) => (
              <a
                key={item.key}
                href={item.href}
                class={cn(
                  'flex flex-1 flex-col items-center gap-0.5 rounded-lg px-1 py-1 text-[11px]',
                  active === item.key
                    ? 'font-medium text-[var(--color-accent)]'
                    : 'text-[var(--color-ink-muted)]',
                )}
              >
                <span class="text-base leading-none">•</span>
                {item.label}
              </a>
            ))}
          </div>
        </nav>
      </div>
    </ToastProvider>
  );
}

export function AppShell(props: Props) {
  if (props.skipAuth) {
    return <ShellInner {...props} />;
  }
  return (
    <AuthGate>
      <ShellInner {...props} />
    </AuthGate>
  );
}
