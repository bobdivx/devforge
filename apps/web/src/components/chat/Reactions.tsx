import { useEffect, useRef, useState } from 'preact/hooks';
import { Reply, SmilePlus } from 'lucide-preact';
import { cn } from '../../lib/cn';
import { prefersReducedMotion } from '../../lib/motion';
import type { Reaction } from './types';

/** Liste blanche (identique au serveur) ; la barre rapide en montre 6. */
export const REACTIONS = ['👍', '👎', '❤️', '🎉', '😄', '🤔', '👀', '🚀'] as const;
export const QUICK_REACTIONS = REACTIONS.slice(0, 6);
export const LONG_PRESS_MS = 400;

/** Pastilles sous la bulle : clic = ajouter / retirer sa réaction. */
export function ReactionPills({ reactions, onToggle }: { reactions: Reaction[]; onToggle?: (emoji: string) => void }) {
  const [popped, setPopped] = useState<string | null>(null);
  if (!reactions.length) return null;
  return (
    <div class="flex flex-wrap gap-1" data-reactions>
      {reactions.map((r) => (
        <button
          key={r.emoji}
          type="button"
          disabled={!onToggle}
          aria-pressed={r.mine}
          aria-label={`${r.emoji} ${r.count} — ${r.mine ? 'retirer ma réaction' : 'réagir'}`}
          class={cn(
            'df-tap-skip inline-flex h-6 items-center gap-1 rounded-full px-2 text-xs tabular-nums transition-colors',
            r.mine
              ? 'bg-[var(--color-accent)]/15 text-[var(--color-ink)] ring-1 ring-inset ring-[var(--color-accent)]/50'
              : 'bg-white/[0.05] text-[var(--color-ink-muted)] ring-1 ring-inset ring-[var(--color-line)] hover:bg-white/[0.09]',
            'disabled:cursor-default',
          )}
          onClick={() => {
            if (!r.mine) setPopped(r.emoji);
            onToggle?.(r.emoji);
          }}
          onAnimationEnd={() => setPopped(null)}
        >
          <span class={cn('inline-block', popped === r.emoji && 'df-pop')} aria-hidden>
            {r.emoji}
          </span>
          {r.count > 1 && <span>{r.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** Barre de 6 emojis (menu « Réagir »), navigable au clavier, Échap pour fermer. */
export function ReactionPicker({ onPick, onClose, onReply }: { onPick: (emoji: string) => void; onClose: () => void; onReply?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
    const onDoc = (e: Event) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const t = window.setTimeout(() => document.addEventListener('pointerdown', onDoc), 0);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('pointerdown', onDoc);
    };
  }, []);
  const onKey = (e: KeyboardEvent) => {
    const items = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const n = (i + (e.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length;
      items[n]?.focus();
    }
  };
  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Réagir"
      onKeyDown={onKey}
      class="df-menu-in absolute bottom-full left-0 z-20 mb-1 flex items-center gap-0.5 rounded-full border border-[var(--color-line-strong)] bg-[var(--color-surface-2)] p-1 shadow-lg"
    >
      {QUICK_REACTIONS.map((e) => (
        <button
          key={e}
          type="button"
          role="menuitem"
          aria-label={`Réagir ${e}`}
          class="df-tap-skip inline-flex h-11 w-11 items-center justify-center rounded-full text-lg transition-transform hover:scale-110 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-[var(--color-accent)] sm:h-9 sm:w-9"
          onClick={() => {
            onPick(e);
            onClose();
          }}
        >
          {e}
        </button>
      ))}
      {onReply && (
        <button
          type="button"
          role="menuitem"
          aria-label="Répondre à ce message"
          class="df-tap-skip ml-0.5 inline-flex h-11 w-11 items-center justify-center rounded-full text-[var(--color-ink-muted)] hover:bg-white/10 hover:text-[var(--color-ink)] focus-visible:outline-2 focus-visible:outline-[var(--color-accent)] sm:h-9 sm:w-9"
          onClick={() => {
            onReply();
            onClose();
          }}
        >
          <Reply size={16} aria-hidden />
        </button>
      )}
    </div>
  );
}

/** Appui long (mobile) : ouvre le menu après 400 ms sans mouvement, petite vibration. */
export function useLongPress(onLong: () => void) {
  const timer = useRef<number | undefined>(undefined);
  const start = useRef<{ x: number; y: number } | null>(null);
  const cancel = () => {
    window.clearTimeout(timer.current);
    start.current = null;
  };
  return {
    onPointerDown: (e: PointerEvent) => {
      if (e.pointerType === 'mouse') return;
      start.current = { x: e.clientX, y: e.clientY };
      timer.current = window.setTimeout(() => {
        if (!prefersReducedMotion()) navigator.vibrate?.(10);
        onLong();
        start.current = null;
      }, LONG_PRESS_MS);
    },
    onPointerMove: (e: PointerEvent) => {
      if (start.current && Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 8) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onContextMenu: (e: Event) => {
      // Appui long tactile : pas de menu natif par-dessus le nôtre.
      if (start.current === null && timer.current) e.preventDefault();
    },
  };
}

/** Boutons au survol (desktop) / au focus (clavier) : « Réagir », « Répondre ». */
export function MessageActions({ onReact, onReply }: { onReact?: (emoji: string) => void; onReply?: () => void }) {
  const [open, setOpen] = useState(false);
  if (!onReact && !onReply) return null;
  const btn =
    'df-hit df-tap-skip inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-[11px] text-[var(--color-ink-faint)] hover:bg-white/5 hover:text-[var(--color-ink)] focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]';
  return (
    <div class={cn('relative flex items-center gap-0.5 transition-opacity', open ? 'opacity-100' : 'opacity-0 group-hover/msg:opacity-100 focus-within:opacity-100 max-lg:hidden')}>
      {onReact && (
        <button type="button" class={btn} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <SmilePlus size={13} aria-hidden />
          Réagir
        </button>
      )}
      {onReply && (
        <button type="button" class={btn} onClick={onReply}>
          <Reply size={13} aria-hidden />
          Répondre
        </button>
      )}
      {open && onReact && <ReactionPicker onPick={onReact} onClose={() => setOpen(false)} />}
    </div>
  );
}
