import { useEffect, useRef, useState } from 'preact/hooks';
import { api, type Project } from '../lib/api';
import type { Bootstrap } from '../lib/auth';
import { projectStatusMeta } from '../lib/status';
import { cn } from '../lib/cn';

type ProjectStats = {
  total: number;
  live: number;
  deploying: number;
  failed: number;
  stopped: number;
};

function computeStats(projects: Project[]): ProjectStats {
  const s: ProjectStats = { total: projects.length, live: 0, deploying: 0, failed: 0, stopped: 0 };
  for (const p of projects) {
    const tone = projectStatusMeta(p.status).tone;
    if (tone === 'ok') s.live += 1;
    else if (tone === 'warn') s.deploying += 1;
    else if (tone === 'danger') s.failed += 1;
    else s.stopped += 1;
  }
  return s;
}

function initials(name: string): string {
  const parts = name.trim().split(/[\s-_]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase() || '?';
}

function StatChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'ok' | 'warn' | 'danger' | 'neutral';
}) {
  const dot =
    tone === 'ok'
      ? 'bg-[var(--color-ok)]'
      : tone === 'warn'
        ? 'bg-[var(--color-warn)]'
        : tone === 'danger'
          ? 'bg-[var(--color-danger)]'
          : 'bg-[var(--color-ink-faint)]';

  return (
    <div
      class="flex shrink-0 items-center gap-2 rounded-full border border-[var(--color-line)] bg-white/[0.03] px-2.5 py-1"
      title={label}
    >
      <span class={cn('h-1.5 w-1.5 rounded-full', dot)} aria-hidden />
      <span class="text-[11px] text-[var(--color-ink-muted)]">{label}</span>
      <span class="text-xs font-semibold tabular-nums text-[var(--color-ink)]">{value}</span>
    </div>
  );
}

export function AppHeader() {
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [ghLogin, setGhLogin] = useState<string | null>(null);
  const [ghAvatar, setGhAvatar] = useState<string | null>(null);
  const [ghUrl, setGhUrl] = useState<string | null>(null);
  const [stats, setStats] = useState<ProjectStats | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [b, gh, projects] = await Promise.all([
          api.bootstrap(),
          api.githubStatus().catch(() => null),
          api.projects().catch(() => null),
        ]);
        if (cancelled) return;
        setBoot(b);
        if (gh?.connected && gh.user) {
          setGhLogin(gh.user.login);
          setGhAvatar(gh.user.avatar_url ?? null);
          setGhUrl(gh.user.html_url ?? `https://github.com/${gh.user.login}`);
        }
        if (projects?.data) setStats(computeStats(projects.data));
      } catch {
        /* AuthGate gère déjà les erreurs auth */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointer = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  async function logout() {
    setLoggingOut(true);
    try {
      await api.logout();
    } finally {
      window.location.replace('/login');
    }
  }

  const isAdmin = boot?.user?.role === 'instance_admin';
  const displayName = ghLogin
    ? `@${ghLogin}`
    : boot?.user?.name || boot?.user?.email || 'Compte';
  const subtitle = ghLogin
    ? boot?.user?.email || boot?.user?.name || 'GitHub'
    : boot?.user?.email || boot?.team?.name || boot?.workspace?.name || '';

  return (
    <header class="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-line)] pb-4">
      <div class="-mx-1 flex min-w-0 max-w-full flex-1 items-center gap-2 overflow-x-auto px-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {stats ? (
          <>
            <StatChip label="En ligne" value={stats.live} tone="ok" />
            <StatChip label="Déploiement" value={stats.deploying} tone="warn" />
            <StatChip label="Échec" value={stats.failed} tone="danger" />
            <StatChip label="Total" value={stats.total} tone="neutral" />
          </>
        ) : (
          <div class="h-7 w-48 animate-pulse rounded-full bg-white/5" aria-hidden />
        )}
      </div>

      <div class="relative" ref={menuRef}>
        <button
          type="button"
          class="flex items-center gap-2.5 rounded-full border border-[var(--color-line)] bg-white/[0.03] py-1 pl-1 pr-3 transition hover:border-white/20 hover:bg-white/[0.06]"
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          onClick={() => setMenuOpen((o) => !o)}
        >
          {ghAvatar ? (
            <img
              src={ghAvatar}
              alt=""
              class="h-8 w-8 rounded-full object-cover"
              referrerpolicy="no-referrer"
            />
          ) : (
            <span class="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-accent-soft)] text-xs font-semibold text-[var(--color-accent)]">
              {initials(boot?.user?.name || boot?.user?.email || 'DF')}
            </span>
          )}
          <span class="hidden max-w-[10rem] truncate text-left sm:block">
            <span class="block text-sm font-medium leading-tight text-[var(--color-ink)]">
              {displayName}
            </span>
            {subtitle && (
              <span class="block truncate text-[11px] text-[var(--color-ink-muted)]">{subtitle}</span>
            )}
          </span>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            class={cn(
              'shrink-0 text-[var(--color-ink-muted)] transition',
              menuOpen && 'rotate-180',
            )}
            aria-hidden
          >
            <path d="M6 9l6 6 6-6" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>

        {menuOpen && (
          <div
            role="menu"
            class="absolute right-0 z-30 mt-2 w-56 overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] py-1 shadow-xl shadow-black/40"
          >
            <div class="border-b border-[var(--color-line)] px-3 py-2.5 sm:hidden">
              <p class="truncate text-sm font-medium">{displayName}</p>
              {subtitle && (
                <p class="truncate text-[11px] text-[var(--color-ink-muted)]">{subtitle}</p>
              )}
            </div>
            <a
              role="menuitem"
              href="/app/team"
              class="block px-3 py-2 text-sm text-[var(--color-ink-muted)] transition hover:bg-white/5 hover:text-[var(--color-ink)]"
              onClick={() => setMenuOpen(false)}
            >
              Compte
            </a>
            {isAdmin && (
              <a
                role="menuitem"
                href="/app/admin"
                class="block px-3 py-2 text-sm text-[var(--color-ink-muted)] transition hover:bg-white/5 hover:text-[var(--color-ink)]"
                onClick={() => setMenuOpen(false)}
              >
                Admin
              </a>
            )}
            <a
              role="menuitem"
              href="/app/settings"
              class="block px-3 py-2 text-sm text-[var(--color-ink-muted)] transition hover:bg-white/5 hover:text-[var(--color-ink)]"
              onClick={() => setMenuOpen(false)}
            >
              Paramètres
            </a>
            {ghUrl && (
              <a
                role="menuitem"
                href={ghUrl}
                target="_blank"
                rel="noreferrer"
                class="block px-3 py-2 text-sm text-[var(--color-ink-muted)] transition hover:bg-white/5 hover:text-[var(--color-ink)]"
                onClick={() => setMenuOpen(false)}
              >
                Profil GitHub
              </a>
            )}
            {!ghLogin && (
              <a
                role="menuitem"
                href="/app/settings?tab=github"
                class="block px-3 py-2 text-sm text-[var(--color-ink-muted)] transition hover:bg-white/5 hover:text-[var(--color-ink)]"
                onClick={() => setMenuOpen(false)}
              >
                Connecter GitHub
              </a>
            )}
            <div class="my-1 border-t border-[var(--color-line)]" />
            <button
              type="button"
              role="menuitem"
              disabled={loggingOut}
              class="block w-full px-3 py-2 text-left text-sm text-[var(--color-danger)] transition hover:bg-white/5 disabled:opacity-50"
              onClick={logout}
            >
              {loggingOut ? 'Déconnexion…' : 'Se déconnecter'}
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
