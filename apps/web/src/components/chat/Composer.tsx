import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import { ArrowUp, Square, X } from 'lucide-preact';
import { cn } from '../../lib/cn';
import { pressScale, prefersReducedMotion } from '../../lib/motion';

export const COMPOSER_MAX_HEIGHT = 160;

export type ComposerProps = {
  value: string;
  onChange(v: string): void;
  onSubmit(text: string): void;
  busy: boolean;
  /** Uniquement quand aucun fil n'est sélectionné : la saisie reste ouverte pendant un run. */
  disabled?: boolean;
  placeholder: string;
  inputId: string;
  /** Affiché à la place d'Envoyer pendant un run. */
  onStop?(): void;
  /** Message en attente (envoyé à la fin du run). */
  queued?: string | null;
  onCancelQueued?(): void;
  class?: string;
  /** Contenu ajouté avant la zone de saisie (rare). */
  children?: ComponentChildren;
};

export function isCoarsePointer(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(pointer: coarse)').matches;
}

/**
 * Entrée envoie (desktop) ; Maj+Entrée = saut de ligne ; pendant une composition IME
 * on ne fait rien. Au doigt (pointer: coarse), Entrée = saut de ligne, envoi par le bouton.
 */
export function shouldSubmitOnEnter(e: {
  key: string;
  shiftKey?: boolean;
  isComposing?: boolean;
  keyCode?: number;
  coarse: boolean;
}): boolean {
  if (e.key !== 'Enter') return false;
  // Safari : keyCode 229 pendant la composition IME.
  if (e.isComposing || e.keyCode === 229) return false;
  if (e.shiftKey) return false;
  return !e.coarse;
}

/** Hauteur auto de la textarea, plafonnée (scroll interne au-delà). */
export function autoResize(el: HTMLTextAreaElement, max = COMPOSER_MAX_HEIGHT) {
  el.style.height = 'auto';
  const next = Math.min(el.scrollHeight, max);
  el.style.height = `${next}px`;
  el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden';
}

export function Composer({
  value,
  onChange,
  onSubmit,
  busy,
  disabled,
  placeholder,
  inputId,
  onStop,
  queued,
  onCancelQueued,
  class: className,
  children,
}: ComposerProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const canSend = !disabled && value.trim().length > 0;

  useLayoutEffect(() => {
    if (ref.current) autoResize(ref.current);
  }, [value]);

  // Redimensionnement de la fenêtre (rotation) : recalculer.
  useEffect(() => {
    const onResize = () => ref.current && autoResize(ref.current);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  function submit() {
    if (!canSend) return;
    const text = value;
    if (isCoarsePointer() && !prefersReducedMotion()) navigator.vibrate?.(8);
    onSubmit(text);
    // Garder le clavier ouvert : le focus reste dans la textarea.
    ref.current?.focus({ preventScroll: true });
  }

  /** Empêche le bouton de voler le focus (sinon le clavier mobile se ferme). */
  const keepFocus = (e: MouseEvent) => e.preventDefault();
  const press = isCoarsePointer() ? undefined : pressScale();

  return (
    <form
      class={cn('flex min-w-0 flex-col gap-2', className)}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {children}
      {queued ? (
        <div class="flex min-w-0 items-center gap-2 self-start rounded-full border border-[var(--color-line-strong)] bg-white/[0.04] py-1 pl-3 pr-1 text-xs text-[var(--color-ink-muted)] max-w-full">
          <span class="min-w-0 truncate">
            <span class="text-[var(--color-ink-faint)]">En attente : </span>
            {queued.replace(/\s+/g, ' ')}
          </span>
          {onCancelQueued && (
            <button
              type="button"
              class="df-hit df-tap-skip inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full hover:bg-white/10 hover:text-[var(--color-ink)]"
              aria-label="Annuler le message en attente"
              title="Annuler le message en attente"
              onMouseDown={keepFocus}
              onClick={() => onCancelQueued()}
            >
              <X size={12} strokeWidth={2.2} aria-hidden />
            </button>
          )}
        </div>
      ) : null}
      <div class="flex min-w-0 items-end gap-2">
        <label for={inputId} class="sr-only">
          {placeholder}
        </label>
        <textarea
          ref={ref}
          id={inputId}
          rows={1}
          data-composer
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          enterkeyhint={isCoarsePointer() ? 'enter' : 'send'}
          autoComplete="off"
          class={cn(
            'block min-h-11 w-full min-w-0 flex-1 resize-none rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] px-3.5 py-2.5 text-base leading-6 text-[var(--color-ink)] outline-none transition-[border-color,box-shadow] duration-200 sm:text-sm sm:leading-6 lg:min-h-10 lg:py-2',
            'placeholder:text-[var(--color-ink-faint)] focus:border-[var(--color-accent)]/50 focus:ring-2 focus:ring-[var(--color-accent-soft)] disabled:opacity-60',
          )}
          style={{ maxHeight: `${COMPOSER_MAX_HEIGHT}px` }}
          onInput={(e) => {
            const el = e.currentTarget;
            autoResize(el);
            onChange(el.value);
          }}
          onKeyDown={(e) => {
            if (shouldSubmitOnEnter({ key: e.key, shiftKey: e.shiftKey, isComposing: e.isComposing, keyCode: e.keyCode, coarse: isCoarsePointer() })) {
              e.preventDefault();
              submit();
            }
          }}
        />
        {busy && canSend && (
          <button
            type="submit"
            class="df-tap-skip inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--color-surface-2)] text-[var(--color-ink)] ring-1 ring-inset ring-[var(--color-line-strong)] transition hover:bg-[var(--color-surface)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] max-lg:h-11 max-lg:w-11"
            aria-label="Mettre en file (envoyé à la fin du travail en cours)"
            title="Mettre en file — envoyé à la fin du travail en cours"
            onMouseDown={keepFocus}
            animate={press}
          >
            <ArrowUp size={18} strokeWidth={2.2} aria-hidden />
          </button>
        )}
        {busy && onStop ? (
          <button
            type="button"
            class="df-tap-skip inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--color-ink)] text-[var(--color-bg)] transition hover:brightness-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] max-lg:h-11 max-lg:w-11"
            aria-label="Arrêter le travail en cours"
            title="Arrêter le travail en cours (les commandes lancées sont stoppées)"
            onMouseDown={keepFocus}
            onClick={() => onStop()}
            animate={press}
          >
            <Square size={14} strokeWidth={2.4} fill="currentColor" aria-hidden />
          </button>
        ) : !busy ? (
          <button
            type="submit"
            disabled={!canSend}
            class="df-tap-skip inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--color-accent)] text-zinc-950 transition hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] disabled:cursor-not-allowed disabled:bg-[var(--color-surface-2)] disabled:text-[var(--color-ink-faint)] max-lg:h-11 max-lg:w-11"
            aria-label="Envoyer"
            title="Envoyer (Entrée) — Maj+Entrée pour un saut de ligne"
            onMouseDown={keepFocus}
            animate={press}
          >
            <ArrowUp size={18} strokeWidth={2.2} aria-hidden />
          </button>
        ) : null}
      </div>
    </form>
  );
}
