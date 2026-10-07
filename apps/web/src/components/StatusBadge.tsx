import type { ComponentChildren } from 'preact';
import { useEffect, useId, useRef, useState } from 'preact/hooks';
import { RotateCw, X } from 'lucide-preact';
import { api, type Project } from '../lib/api';
import { projectStatusMeta } from '../lib/status';
import { cn } from '../lib/cn';
import { Portal } from './ui';

/* ------------------------------------------------------------------ */
/* Données partagées : un seul sondage /projects, quel que soit le     */
/* nombre de badges affichés (en-tête, page projet…).                  */
/* ------------------------------------------------------------------ */

type Snapshot = { projects: Project[] | null; failed: boolean };

let snapshot: Snapshot = { projects: null, failed: false };
const listeners = new Set<(s: Snapshot) => void>();
let timer: number | undefined;
let inflight = false;
let visibilityBound = false;

function emit() {
  for (const l of listeners) l(snapshot);
}

function anyDeploying(projects: Project[] | null) {
  return !!projects?.some((p) => projectStatusMeta(p.status).tone === 'warn');
}

function schedule() {
  if (timer) window.clearTimeout(timer);
  timer = undefined;
  if (listeners.size === 0) return;
  const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
  // Plus réactif pendant une mise en ligne, très calme quand l'onglet est caché.
  const delay = hidden ? 60_000 : anyDeploying(snapshot.projects) ? 6_000 : 20_000;
  timer = window.setTimeout(() => void refresh(), delay);
}

async function refresh() {
  if (inflight) return;
  inflight = true;
  try {
    const r = await api.projects();
    snapshot = { projects: r?.data ?? [], failed: false };
  } catch {
    // On garde la dernière liste connue ; on ne signale l'échec que si on n'a rien.
    snapshot = { projects: snapshot.projects, failed: snapshot.projects == null };
  } finally {
    inflight = false;
    emit();
    schedule();
  }
}

function onVisibility() {
  if (document.visibilityState === 'visible' && listeners.size > 0) void refresh();
}

function useProjectsSnapshot(): Snapshot {
  const [s, setS] = useState<Snapshot>(snapshot);
  useEffect(() => {
    listeners.add(setS);
    if (!visibilityBound) {
      document.addEventListener('visibilitychange', onVisibility);
      visibilityBound = true;
    }
    if (listeners.size === 1) void refresh();
    else setS(snapshot);
    return () => {
      listeners.delete(setS);
      if (listeners.size === 0) {
        if (timer) window.clearTimeout(timer);
        timer = undefined;
      }
    };
  }, []);
  return s;
}

/* ------------------------------------------------------------------ */
/* Résumé                                                               */
/* ------------------------------------------------------------------ */

type Kind = 'loading' | 'unknown' | 'empty' | 'ok' | 'deploying' | 'failed';

type Summary = {
  kind: Kind;
  total: number;
  live: number;
  deploying: Project[];
  failed: Project[];
};

function summarize(s: Snapshot): Summary {
  const base = { total: 0, live: 0, deploying: [] as Project[], failed: [] as Project[] };
  if (s.projects == null) return { ...base, kind: s.failed ? 'unknown' : 'loading' };
  const out: Summary = { ...base, kind: 'ok', total: s.projects.length };
  for (const p of s.projects) {
    const tone = projectStatusMeta(p.status).tone;
    if (tone === 'ok') out.live += 1;
    else if (tone === 'warn') out.deploying.push(p);
    else if (tone === 'danger') out.failed.push(p);
  }
  out.kind = out.failed.length
    ? 'failed'
    : out.deploying.length
      ? 'deploying'
      : out.total === 0
        ? 'empty'
        : 'ok';
  return out;
}

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

function badgeText(s: Summary): string {
  switch (s.kind) {
    case 'failed':
      return `${s.failed.length} en échec`;
    case 'deploying':
      return plural(s.deploying.length, 'déploiement', 'déploiements');
    case 'empty':
      return 'Aucune app';
    case 'unknown':
      return 'État indisponible';
    default:
      return 'Tout va bien';
  }
}

function describe(s: Summary): string {
  const parts: string[] = [];
  if (s.failed.length) parts.push(`${plural(s.failed.length, 'app', 'apps')} en échec`);
  if (s.deploying.length) {
    parts.push(
      `${plural(s.deploying.length, 'déploiement', 'déploiements')} en cours`,
    );
  }
  switch (s.kind) {
    case 'loading':
      return 'Chargement de l’état des apps';
    case 'unknown':
      return 'État des apps indisponible pour le moment';
    case 'empty':
      return 'Aucune app pour l’instant';
    case 'ok':
      return `tout va bien, ${plural(s.live, 'app en ligne', 'apps en ligne')}`;
    default:
      return parts.join(' et ');
  }
}

function announce(s: Summary): string {
  switch (s.kind) {
    case 'failed':
      return `Attention : ${describe(s)}.`;
    case 'deploying':
      return `${describe(s)}.`;
    case 'ok':
      return 'Tout va bien, toutes les apps tournent.';
    default:
      return '';
  }
}

const projectHref = (uuid: string) => `/app/projects/view?uuid=${encodeURIComponent(uuid)}`;
const logsHref = (uuid: string) => `${projectHref(uuid)}&tab=deployments`;

/* ------------------------------------------------------------------ */
/* Badge                                                                */
/* ------------------------------------------------------------------ */

type Props = {
  /**
   * `compact` : pastille + nombre seulement, et rien du tout quand tout va bien
   * (pages projet : l'en-tête du projet reste prioritaire).
   */
  compact?: boolean;
  class?: string;
};

/**
 * Un seul badge d'état à la place des compteurs (mobile et tablette).
 * Tout va bien → calme et inerte ; déploiement / échec → ouvre le détail
 * (feuille du bas sur téléphone, bulle sur tablette).
 */
export function StatusBadge({ compact = false, class: className }: Props) {
  const snap = useProjectsSnapshot();
  const s = summarize(snap);
  const [open, setOpen] = useState(false);
  const [live, setLive] = useState('');
  const btnRef = useRef<HTMLButtonElement>(null);
  const prevKey = useRef<string | null>(null);

  // aria-live : on n'annonce que les changements, pas le premier chargement.
  const key = `${s.kind}:${s.failed.length}:${s.deploying.length}`;
  useEffect(() => {
    if (s.kind === 'loading') return;
    if (prevKey.current != null && prevKey.current !== key) setLive(announce(s));
    prevKey.current = key;
  }, [key]);

  const interactive = s.kind === 'failed' || s.kind === 'deploying';
  useEffect(() => {
    if (!interactive && open) setOpen(false);
  }, [interactive, open]);

  const liveRegion = (
    <span class="sr-only" aria-live="polite" aria-atomic="true">
      {live}
    </span>
  );

  // L'enveloppe porte la classe (ex. `lg:hidden`) : masquer le badge masque aussi
  // sa zone aria-live, pour ne jamais annoncer deux fois le même changement.
  const wrap = (children: ComponentChildren) => (
    <span class={cn('inline-flex shrink-0 items-center', className)} data-df-status-badge={s.kind}>
      {children}
      {liveRegion}
    </span>
  );

  if (compact && !interactive) return wrap(null);

  const tone =
    s.kind === 'failed'
      ? 'text-[var(--color-danger)] border-[color-mix(in_srgb,var(--color-danger)_35%,transparent)] bg-[color-mix(in_srgb,var(--color-danger)_10%,transparent)]'
      : s.kind === 'deploying'
        ? 'text-[var(--color-warn)] border-[color-mix(in_srgb,var(--color-warn)_30%,transparent)] bg-[color-mix(in_srgb,var(--color-warn)_8%,transparent)]'
        : 'text-[var(--color-ink-muted)] border-[var(--color-line)] bg-white/[0.03]';

  const dotColor =
    s.kind === 'failed'
      ? 'bg-[var(--color-danger)]'
      : s.kind === 'ok'
        ? 'bg-[var(--color-ok)]'
        : 'bg-[var(--color-ink-faint)]';

  const icon =
    s.kind === 'deploying' ? (
      <RotateCw
        size={13}
        strokeWidth={2.4}
        class="shrink-0 motion-safe:animate-[spin_2.4s_linear_infinite]"
        aria-hidden
      />
    ) : (
      <span class={cn('h-2 w-2 shrink-0 rounded-full', dotColor)} aria-hidden />
    );

  const count = s.kind === 'failed' ? s.failed.length : s.deploying.length;
  const label = compact ? String(count) : badgeText(s);

  if (s.kind === 'loading') {
    return wrap(<span class="block h-9 w-28 shrink-0 animate-pulse rounded-full bg-white/5" aria-hidden />);
  }

  const pillBase =
    'inline-flex shrink-0 items-center gap-2 rounded-full border text-[13px] font-medium leading-none';

  if (!interactive) {
    return wrap(
      <span
        role="img"
        aria-label={`État des apps : ${describe(s)}`}
        title={describe(s)}
        class={cn(pillBase, 'h-9 px-3', tone)}
      >
        {icon}
        <span class="whitespace-nowrap">{label}</span>
      </span>,
    );
  }

  return wrap(
    <>
      <button
        ref={btnRef}
        type="button"
        class={cn(
          pillBase,
          // 44 px de cible tactile, même si le contour visible reste fin.
          'min-h-[44px] min-w-[44px] justify-center px-3.5 transition-[background-color,transform] duration-200 active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]',
          tone,
        )}
        aria-label={`État des apps : ${describe(s)}. Voir le détail`}
        title={describe(s)}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {icon}
        <span class="whitespace-nowrap tabular-nums">{label}</span>
        {s.kind === 'failed' && s.deploying.length > 0 && !compact && (
          <span
            class="ml-0.5 inline-flex items-center gap-1 text-[11px] font-normal text-[var(--color-warn)]"
            aria-hidden
          >
            <RotateCw size={10} strokeWidth={2.4} />
            {s.deploying.length}
          </span>
        )}
      </button>
      {open && <StatusSheet summary={s} anchor={btnRef} onClose={() => setOpen(false)} />}
    </>,
  );
}

/* ------------------------------------------------------------------ */
/* Bureau : les trois compteurs d'origine, nourris par le même sondage. */
/* ------------------------------------------------------------------ */

export function StatusCounters({ class: className }: { class?: string }) {
  const s = summarize(useProjectsSnapshot());
  if (s.kind === 'loading') {
    return <div class={cn('h-7 w-48 animate-pulse rounded-full bg-white/5', className)} aria-hidden />;
  }
  if (s.kind === 'unknown') return null;
  const chips: Array<{ label: string; value: number; dot: string }> = [
    { label: 'En ligne', value: s.live, dot: 'bg-[var(--color-ok)]' },
    { label: 'Déploiement', value: s.deploying.length, dot: 'bg-[var(--color-warn)]' },
    { label: 'Échec', value: s.failed.length, dot: 'bg-[var(--color-danger)]' },
  ];
  return (
    <div class={cn('items-center gap-2', className)}>
      {chips.map((c) => (
        <div
          key={c.label}
          class="flex shrink-0 items-center gap-2 rounded-full border border-[var(--color-line)] bg-white/[0.03] px-2.5 py-1"
          title={c.label}
        >
          <span class={cn('h-1.5 w-1.5 rounded-full', c.dot)} aria-hidden />
          <span class="text-[11px] text-[var(--color-ink-muted)]">{c.label}</span>
          <span class="text-xs font-semibold tabular-nums text-[var(--color-ink)]">{c.value}</span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Feuille (téléphone) / bulle (tablette)                               */
/* ------------------------------------------------------------------ */

const FOCUSABLE =
  'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"]), input, select, textarea';

function StatusSheet({
  summary: s,
  anchor,
  onClose,
}: {
  summary: Summary;
  anchor: { current: HTMLButtonElement | null };
  onClose: () => void;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const isTablet = () => window.matchMedia('(min-width: 768px)').matches;
  // Position calculée dès le premier rendu : la bulle est visible tout de suite,
  // donc le focus peut s'y poser sans attendre.
  const measure = () => {
    const r = anchor.current?.getBoundingClientRect();
    if (!isTablet() || !r) return null;
    const width = Math.min(384, window.innerWidth - 32);
    const left = Math.max(16, Math.min(r.left, window.innerWidth - width - 16));
    return { top: r.bottom + 8, left, width };
  };
  const [tablet, setTablet] = useState(isTablet);
  const [pos, setPos] = useState(measure);

  const place = () => {
    if (window.matchMedia('(min-width: 1024px)').matches) {
      onClose();
      return;
    }
    setTablet(isTablet());
    setPos(measure());
  };

  useEffect(() => {
    const opener = anchor.current;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (active === first || !panelRef.current.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !panelRef.current.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', place);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', place);
      document.body.style.overflow = prevOverflow;
      opener?.focus();
    };
  }, []);

  const intro =
    s.failed.length && s.deploying.length
      ? `${describe(s)}. Le reste tourne normalement.`
      : s.failed.length
        ? `${plural(s.failed.length, 'app a besoin', 'apps ont besoin')} d’un coup d’œil. Le reste tourne normalement.`
        : `${plural(s.deploying.length, 'mise en ligne', 'mises en ligne')} en cours, rien à faire pour l’instant.`;

  const body = (
    <>
      <div class="flex shrink-0 items-start justify-between gap-3 border-b border-[var(--color-line)] py-2 pl-4 pr-1.5">
        <div class="min-w-0 py-1.5">
          <h2 id={titleId} class="text-base font-medium tracking-tight text-[var(--color-ink)]">
            État des apps
          </h2>
          <p class="mt-0.5 text-[13px] text-[var(--color-ink-muted)]">{intro}</p>
        </div>
        <button
          ref={closeRef}
          type="button"
          class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-[var(--color-ink-muted)] transition hover:bg-white/5 hover:text-[var(--color-ink)] focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]"
          onClick={onClose}
          aria-label="Fermer"
        >
          <X size={18} aria-hidden />
        </button>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-2">
        {s.failed.length > 0 && (
          <Section title="En échec" tone="danger" projects={s.failed} withLogs />
        )}
        {s.deploying.length > 0 && (
          <Section title="Mise en ligne en cours" tone="warn" projects={s.deploying} />
        )}
        <a
          href="/app"
          class="mt-1 flex min-h-[44px] items-center justify-center rounded-xl px-3 text-[13px] text-[var(--color-ink-muted)] transition hover:bg-white/5 hover:text-[var(--color-ink)]"
        >
          Voir toutes les apps · {plural(s.live, 'en ligne', 'en ligne')}
        </a>
      </div>
    </>
  );

  return (
    <Portal>
      <div class="fixed inset-0 z-50" data-df-status-sheet={tablet ? 'popover' : 'sheet'}>
        <button
          type="button"
          tabIndex={-1}
          aria-label="Fermer"
          class={cn(
            'df-modal-backdrop absolute inset-0 cursor-default',
            tablet ? 'bg-black/20' : 'bg-black/60 backdrop-blur-sm',
          )}
          onClick={onClose}
        />
        {tablet ? (
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            class="df-menu-enter absolute flex max-h-[min(70dvh,32rem)] flex-col overflow-hidden rounded-2xl border border-[var(--color-line-strong)] bg-[var(--color-card)] shadow-2xl shadow-black/50"
            style={pos ? { top: `${pos.top}px`, left: `${pos.left}px`, width: `${pos.width}px` } : { top: '4.5rem', left: '1rem', width: 'min(24rem, calc(100vw - 2rem))' }}
          >
            {body}
          </div>
        ) : (
          <div class="absolute inset-x-0 bottom-0 flex justify-center">
            <div
              ref={panelRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              class="df-sheet-panel relative flex max-h-[min(80dvh,640px)] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border-t border-[var(--color-line-strong)] bg-[var(--color-card)] shadow-2xl"
              style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
            >
              <div class="flex justify-center pt-2" aria-hidden>
                <span class="h-1 w-9 rounded-full bg-white/15" />
              </div>
              {body}
            </div>
          </div>
        )}
      </div>
    </Portal>
  );
}

function Section({
  title,
  tone,
  projects,
  withLogs = false,
}: {
  title: string;
  tone: 'danger' | 'warn';
  projects: Project[];
  withLogs?: boolean;
}) {
  const color = tone === 'danger' ? 'var(--color-danger)' : 'var(--color-warn)';
  return (
    <section class="mb-2">
      <h3
        class="px-2 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-[0.12em]"
        style={{ color }}
      >
        {title} · {projects.length}
      </h3>
      <ul class="flex flex-col gap-1">
        {projects.map((p) => {
          const meta = projectStatusMeta(p.status);
          return (
            <li key={p.uuid} class="flex items-stretch gap-1.5">
              <a
                href={projectHref(p.uuid)}
                class="flex min-h-[48px] min-w-0 flex-1 items-center gap-3 rounded-xl px-2.5 transition hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]"
              >
                <span
                  class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm font-semibold"
                  style={{ color, background: `color-mix(in srgb, ${color} 12%, transparent)` }}
                  aria-hidden
                >
                  {p.name.slice(0, 1).toUpperCase()}
                </span>
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-sm font-medium text-[var(--color-ink)]">
                    {p.name}
                  </span>
                  <span class="block truncate text-xs" style={{ color }}>
                    {meta.label}
                  </span>
                </span>
              </a>
              <a
                href={logsHref(p.uuid)}
                class="flex min-h-[44px] shrink-0 items-center self-center rounded-xl border border-[var(--color-line)] px-3 text-xs text-[var(--color-ink-muted)] transition hover:border-white/20 hover:text-[var(--color-ink)] focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]"
                aria-label={`${withLogs ? 'Journaux de déploiement' : 'Suivre le déploiement'} de ${p.name}`}
              >
                {withLogs ? 'Journaux' : 'Suivre'}
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
