import type { ComponentChildren, JSX } from 'preact';
import { cn } from '../../lib/cn';
import { enterUp, interactiveLift, motion } from '../../lib/motion';

const TILE_CLASS =
  'group flex min-h-[8.75rem] cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl bg-[#1c1c1e] px-2.5 py-3 text-center sm:aspect-square sm:min-h-0 sm:gap-3 sm:px-3 sm:py-4';

const ICON_WRAP =
  'relative flex h-16 w-16 items-center justify-center rounded-[1.15rem] bg-[var(--color-accent-soft)] text-[var(--color-accent)] transition-transform duration-200 ease-out group-hover:scale-[1.04] sm:h-[4.5rem] sm:w-[4.5rem]';

type HubGridProps = {
  class?: string;
  cols?: 3 | 4 | 5;
  children: ComponentChildren;
};

/** Grille responsive type Settings / Home (PandaOS). */
export function HubGrid({ class: className, cols = 4, children }: HubGridProps) {
  return (
    <div
      class={cn(
        'grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-4',
        cols === 3 && 'md:grid-cols-3',
        cols === 4 && 'md:grid-cols-4',
        cols === 5 && 'md:grid-cols-4 lg:grid-cols-5',
        className,
      )}
    >
      {children}
    </div>
  );
}

type HubTileProps = {
  title: string;
  description?: string;
  icon: ComponentChildren;
  index?: number;
  href?: string;
  onClick?: (e: JSX.TargetedMouseEvent<HTMLElement>) => void;
  badge?: ComponentChildren;
  class?: string;
  /** Classes du conteneur d’icône (ex. fond neutre pour favicons). */
  iconClass?: string;
  /** Contenu alternatif sous le titre (ex. statut coloré). */
  subtitle?: ComponentChildren;
};

export function HubTile({
  title,
  description,
  icon,
  index = 0,
  href,
  onClick,
  badge,
  class: className,
  iconClass,
  subtitle,
}: HubTileProps) {
  const body = (
    <>
      <div class={cn(ICON_WRAP, iconClass)}>
        {icon}
        {badge}
      </div>
      <div class="w-full">
        <div class="truncate text-[13px] font-medium text-white sm:text-sm">{title}</div>
        {subtitle ??
          (description ? (
            <div class="mt-1 line-clamp-2 text-[11px] leading-snug text-[var(--color-ink-muted)]">
              {description}
            </div>
          ) : null)}
      </div>
    </>
  );

  const shared = cn(TILE_CLASS, className);
  const animate = motion(enterUp(Math.min(index * 0.04, 0.28)), interactiveLift());

  return href ? (
    <a href={href} onClick={onClick} class={shared} animate={animate}>
      {body}
    </a>
  ) : (
    <button type="button" onClick={onClick} class={cn(shared, 'w-full')} animate={animate}>
      {body}
    </button>
  );
}

/** Tuile « + » pointillée, comme sur la page Apps. */
export function HubAddTile({
  label = 'Ajouter',
  index = 0,
  onClick,
}: {
  label?: string;
  index?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      class="group flex min-h-[8.75rem] w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-white/15 bg-[#1c1c1e] px-2.5 py-3 sm:aspect-square sm:min-h-0 sm:gap-3 sm:px-3 sm:py-4"
      animate={motion(enterUp(Math.min(index * 0.04, 0.28)), interactiveLift())}
    >
      <div class="flex h-16 w-16 items-center justify-center rounded-[1.15rem] border border-dashed border-white/20 text-[var(--color-ink-muted)] transition group-hover:scale-[1.03] group-hover:border-white/30 group-hover:text-white sm:h-[4.5rem] sm:w-[4.5rem]">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden>
          <path d="M12 5v14M5 12h14" stroke-linecap="round" />
        </svg>
      </div>
      <div class="w-full text-center">
        <div class="text-sm font-medium text-[var(--color-ink-muted)] group-hover:text-white">
          {label}
        </div>
        <div class="mt-1 text-[11px] font-medium text-transparent" aria-hidden>
          &nbsp;
        </div>
      </div>
    </button>
  );
}

/** Icônes stroke réutilisables pour les hubs (Settings, Compte, Admin…). */
export function HubIcon({ name, size = 24 }: { name: string; size?: number }) {
  const props = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none' as const,
    stroke: 'currentColor',
    'stroke-width': 2,
    'aria-hidden': true as const,
  };

  const icons: Record<string, JSX.Element> = {
    settings: (
      <svg {...props}>
        <circle cx="12" cy="12" r="3" />
        <path d="M12 1v6m0 6v6M5.6 5.6l4.2 4.2m4.2 4.2l4.2 4.2M1 12h6m6 0h6M5.6 18.4l4.2-4.2m4.2-4.2l4.2-4.2" />
      </svg>
    ),
    globe: (
      <svg {...props}>
        <circle cx="12" cy="12" r="10" />
        <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      </svg>
    ),
    github: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
      </svg>
    ),
    server: (
      <svg {...props}>
        <rect x="2" y="2" width="20" height="8" rx="2" />
        <rect x="2" y="14" width="20" height="8" rx="2" />
        <path d="M6 6h.01M6 18h.01" />
      </svg>
    ),
    brain: (
      <svg {...props}>
        <path d="M9.5 2A2.5 2.5 0 0112 4.5v15a2.5 2.5 0 01-4.96.44 2.5 2.5 0 01-2.96-3.08 3 3 0 01-.34-5.58 2.5 2.5 0 011.32-4.24 2.5 2.5 0 011.98-3A2.5 2.5 0 019.5 2zM14.5 2A2.5 2.5 0 0112 4.5v15a2.5 2.5 0 004.96.44 2.5 2.5 0 002.96-3.08 3 3 0 00.34-5.58 2.5 2.5 0 00-1.32-4.24 2.5 2.5 0 00-1.98-3A2.5 2.5 0 0014.5 2z" />
      </svg>
    ),
    shield: (
      <svg {...props}>
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>
    ),
    archive: (
      <svg {...props}>
        <path d="M21 8v13H3V8M1 3h22v5H1zM10 12h4" />
      </svg>
    ),
    refresh: (
      <svg {...props}>
        <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0118.8-4.3M22 12.5a10 10 0 01-18.8 4.2" />
      </svg>
    ),
    user: (
      <svg {...props}>
        <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" stroke-linecap="round" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    ),
    key: (
      <svg {...props}>
        <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    ),
    users: (
      <svg {...props}>
        <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" stroke-linecap="round" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" stroke-linecap="round" />
      </svg>
    ),
    network: (
      <svg {...props}>
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
      </svg>
    ),
    heart: (
      <svg {...props}>
        <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" />
      </svg>
    ),
  };

  return icons[name] || icons.settings;
}
