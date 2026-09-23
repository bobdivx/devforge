import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { globalNavForRole, mobileBottomNav, WORKER_NAV, type NavItem } from '../lib/nav';
import { BetaBadge } from './ui';
import { api } from '../lib/api';
import { cn } from '../lib/cn';
import { ToastProvider } from './ui';
import { AuthGate } from './AuthGate';
import { AppHeader } from './AppHeader';
import { LaunchedAgentsSheet } from './LaunchedAgentsSheet';
import { useLaunchedAgents } from './LaunchedAgentsMenu';
import { pollLaunchedAgents } from '../lib/launched-agents';
import { UpdateRecoveryOverlay } from './UpdateRecoveryOverlay';

type Props = {
  active?: string;
  children: ComponentChildren;
  /** Sous-nav sidebar (projet, settings…). Alias historique : projectNav. */
  sideNav?: NavItem[];
  sideNavLabel?: string;
  /** @deprecated préférer sideNav */
  projectNav?: NavItem[];
  title?: ComponentChildren;
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

/** Labels courts pour la bottom bar (largeur limitée). */
function shortLabel(label: string): string {
  const map: Record<string, string> = {
    Projects: 'Projets',
    Settings: 'Réglages',
    Compte: 'Compte',
    Admin: 'Admin',
    Apps: 'Apps',
    MCP: 'MCP',
    Tokens: 'Tokens',
    Cluster: 'Cluster',
  };
  return map[label] ?? label;
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
  const onNodePage =
    typeof window !== 'undefined' && window.location.pathname.startsWith('/app/node');
  const [isWorker, setIsWorker] = useState(onNodePage);
  const [navItems, setNavItems] = useState(() =>
    onNodePage ? WORKER_NAV : globalNavForRole(null),
  );
  const [userRole, setUserRole] = useState<string | null>(null);
  const [agentsSheetOpen, setAgentsSheetOpen] = useState(false);
  const launchedAgents = useLaunchedAgents();
  const [showRecovery, setShowRecovery] = useState(false);
  const nav = sideNav ?? projectNav;
  const navLabel = sideNav ? sideNavLabel : projectNav ? 'Projet' : sideNavLabel;

  useEffect(() => {
    let cancelled = false;
    api
      .bootstrap()
      .then((b) => {
        if (!cancelled) {
          const worker = b.cluster?.role === 'worker';
          setIsWorker(worker);
          setNavItems(worker ? WORKER_NAV : globalNavForRole(b.user?.role));
          setUserRole(b.user?.role ?? null);
        }
      })
      .catch(() => {
        /* AuthGate gère */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (isWorker) return;
    return pollLaunchedAgents();
  }, [isWorker]);

  useEffect(() => {
    let failureCount = 0;
    let recoveryShown = false;
    const isUpdatePage = typeof window !== 'undefined' && window.location.pathname.startsWith('/app/update');

    const originalFetch = window.fetch;
    const wrappedFetch: typeof fetch = async (...args) => {
      try {
        const response = await originalFetch(...args);
        if (response.ok) {
          failureCount = 0;
        } else if (response.status === 502 || response.status === 503) {
          failureCount += 1;
          if (failureCount >= 2 && !recoveryShown && !isUpdatePage) {
            recoveryShown = true;
            setShowRecovery(true);
          }
        }
        return response;
      } catch (error) {
        failureCount += 1;
        if (failureCount >= 2 && !recoveryShown && !isUpdatePage) {
          recoveryShown = true;
          setShowRecovery(true);
        }
        throw error;
      }
    };

    window.fetch = wrappedFetch;

    return () => {
      window.fetch = originalFetch;
    };
  }, []);

  return (
    <ToastProvider>
      <UpdateRecoveryOverlay
        show={showRecovery}
        onRecovered={() => setShowRecovery(false)}
      />
      {!isWorker && (
        <LaunchedAgentsSheet
          open={agentsSheetOpen}
          onClose={() => setAgentsSheetOpen(false)}
        />
      )}
      <div class="min-h-screen pb-[calc(4.5rem+env(safe-area-inset-bottom))] lg:pb-8">
        <div
          class={cn(
            'mx-auto flex min-h-screen px-4 pt-4 lg:px-6',
            // Plus d’air quand le menu projet est présent (évite le chevauchement)
            nav ? 'max-w-7xl gap-6 lg:gap-10' : 'max-w-6xl gap-6 lg:gap-8',
          )}
        >
          <aside
            class={cn(
              'hidden shrink-0 lg:block',
              'sticky top-4 self-start max-h-[calc(100dvh-1.5rem)] overflow-y-auto overflow-x-hidden',
              'border-r border-[var(--color-line)] pr-5',
              nav ? 'w-56' : 'w-52',
            )}
          >
            <a
              href={isWorker ? '/app/node' : '/app'}
              class="mb-8 flex items-center gap-2.5 transition-opacity duration-200 hover:opacity-90"
            >
              <span class="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--color-accent-soft)] text-[var(--color-accent)] transition-transform duration-200 hover:scale-105">
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
              <span class="text-[15px] font-semibold tracking-tight">DevForge</span>
            </a>
            <nav class="flex flex-col gap-0.5">
              {navItems.map((item) => (
                <a
                  key={item.key}
                  href={item.href}
                  data-active={active === item.key ? 'true' : 'false'}
                  class={cn(
                    'df-nav-active-indicator rounded-lg px-3 py-2 text-sm transition-[background-color,color,transform] duration-200',
                    active === item.key
                      ? 'bg-[var(--color-accent-soft)] font-medium text-[var(--color-accent)]'
                      : 'text-[var(--color-ink-muted)] hover:bg-white/5 hover:text-[var(--color-ink)]',
                  )}
                >
                  <span class="flex items-center justify-between gap-2">
                    <span>{item.label}</span>
                    {item.beta && <BetaBadge />}
                  </span>
                </a>
              ))}
            </nav>
            {nav && (
              <div class="mt-8">
                <div class="mb-2 px-3 text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--color-ink-faint)]">
                  {navLabel}
                </div>
                <nav class="flex flex-col gap-0.5 pr-1">
                  {nav.map((item) => {
                    const on = sideNavItemActive(item);
                    return (
                      <a
                        key={item.key}
                        href={item.href}
                        class={cn(
                          'rounded-lg px-3 py-2 text-sm transition-[background-color,color,transform] duration-200',
                          on
                            ? 'bg-white/5 font-medium text-[var(--color-ink)]'
                            : 'text-[var(--color-ink-muted)] hover:bg-white/5 hover:text-[var(--color-ink)]',
                        )}
                      >
                        <span class="flex items-center justify-between gap-2">
                          <span>{item.label}</span>
                          {item.beta && <BetaBadge />}
                        </span>
                      </a>
                    );
                  })}
                </nav>
              </div>
            )}
          </aside>

          <main class="df-page-enter min-w-0 flex-1 py-2 lg:pl-1">
            <AppHeader worker={isWorker} />
            {(title || actions) && (
              <div class="mb-4 flex flex-col gap-3 sm:mb-6 sm:flex-row sm:items-end sm:justify-between">
                <div class="min-w-0">
                  {title && (
                    <h1 class="break-words text-2xl font-semibold tracking-tight md:text-3xl">{title}</h1>
                  )}
                  {description && (
                    <p class="mt-2 text-sm text-[var(--color-ink-muted)]">{description}</p>
                  )}
                </div>
                {actions && <div class="flex flex-wrap gap-2">{actions}</div>}
              </div>
            )}

            {/* Sous-nav mobile (projet / settings) — scroll horizontal + label pour éviter confusion */}
            {nav && (
              <div class="-mx-4 mb-4 border-b border-[var(--color-line)] lg:hidden">
                <div class="overflow-x-auto px-4 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  <div class="mb-1.5 flex items-center gap-2">
                    <span class="text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--color-ink-faint)]">
                      {navLabel}
                    </span>
                  </div>
                  <nav class="flex w-max gap-1 pb-3" aria-label={navLabel}>
                    {nav.map((item) => {
                      const on = sideNavItemActive(item);
                      return (
                        <a
                          key={item.key}
                          href={item.href}
                          class={cn(
                            'shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-[background-color,color,transform] duration-200 active:scale-[0.97]',
                            on
                              ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                              : 'bg-white/[0.03] text-[var(--color-ink-muted)] hover:bg-white/5 hover:text-[var(--color-ink)]',
                          )}
                        >
                          <span class="inline-flex items-center gap-1.5">
                            {item.label}
                            {item.beta && <BetaBadge />}
                          </span>
                        </a>
                      );
                    })}
                  </nav>
                </div>
              </div>
            )}

            {children}
          </main>
        </div>

        <nav
          class="fixed inset-x-0 bottom-0 z-20 border-t border-[var(--color-line)] bg-[var(--color-bg)]/95 backdrop-blur lg:hidden"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
          aria-label="Navigation principale"
        >
          <div class="mx-auto flex max-w-lg justify-around gap-0.5 px-1 py-1.5">
            {(isWorker ? WORKER_NAV : mobileBottomNav(userRole)).map((item) => {
              if (item.key === 'agents') {
                const count = launchedAgents.length;
                const anyWorking = launchedAgents.some((agent) => agent.status === 'working');
                const label = count === 1 ? launchedAgents[0].title : item.label;
                return (
                  <button
                    key={item.key}
                    type="button"
                    class={cn(
                      'flex min-h-[44px] min-w-[3.25rem] flex-1 flex-col items-center justify-center gap-0.5 rounded-lg px-2 py-1.5 text-[10px] leading-tight transition-[background-color,color,transform] duration-200 md:hidden',
                      agentsSheetOpen
                        ? 'bg-[var(--color-accent-soft)] font-medium text-[var(--color-accent)]'
                        : 'text-[var(--color-ink-muted)] active:scale-[0.96] active:bg-white/5',
                    )}
                    onClick={() => setAgentsSheetOpen(true)}
                    aria-label="Agents lancés"
                    aria-haspopup="dialog"
                    aria-expanded={agentsSheetOpen}
                  >
                    <span
                      class={cn(
                        'text-sm font-semibold leading-none',
                        anyWorking && 'text-[var(--color-warn)]',
                      )}
                      aria-hidden
                    >
                      {count > 0 ? count : '•'}
                    </span>
                    <span class="max-w-full truncate">{label}</span>
                  </button>
                );
              }
              return (
                <a
                  key={item.key}
                  href={item.href}
                  class={cn(
                    'flex min-h-[44px] min-w-[3.25rem] flex-1 flex-col items-center justify-center gap-0.5 rounded-lg px-2 py-1.5 text-[10px] leading-tight transition-[background-color,color,transform] duration-200 active:scale-[0.96]',
                    active === item.key
                      ? 'bg-[var(--color-accent-soft)] font-medium text-[var(--color-accent)]'
                      : 'text-[var(--color-ink-muted)] active:bg-white/5',
                  )}
                  aria-current={active === item.key ? 'page' : undefined}
                >
                  <span class="text-base leading-none" aria-hidden>
                    •
                  </span>
                  <span class="max-w-full truncate">{shortLabel(item.label)}</span>
                </a>
              );
            })}
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
