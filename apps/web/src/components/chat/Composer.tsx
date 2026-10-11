import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { AlertCircle, ArrowUp, CornerDownRight, Loader2, Paperclip, Square, X } from 'lucide-preact';
import { ACCEPTED_IMAGE_TYPES } from '../../lib/image-compress';
import type { PendingAttachment } from './useAttachments';
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
  /** P5-02 : images jointes (coller, glisser-déposer, trombone). */
  attachments?: PendingAttachment[];
  onAddFiles?(files: File[]): void;
  onRemoveAttachment?(localId: string): void;
  /** P5-06 : bandeau « En réponse à ». */
  replyTo?: { excerpt: string } | null;
  onCancelReply?(): void;
};

/** Fichiers images d'un collage (captures d'écran comprises). */
export function imageFilesFrom(data: { files?: FileList | File[] | null; items?: DataTransferItemList | null } | null): File[] {
  if (!data) return [];
  const files = Array.from(data.files ?? []);
  if (!files.length && data.items) {
    for (const it of Array.from(data.items)) {
      if (it.kind === 'file') {
        const f = it.getAsFile();
        if (f) files.push(f);
      }
    }
  }
  return files.filter((f) => f.type.startsWith('image/'));
}

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
  attachments = [],
  onAddFiles,
  onRemoveAttachment,
  replyTo,
  onCancelReply,
}: ComposerProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const readyImages = attachments.some((a) => a.status === 'ready');
  const uploading = attachments.some((a) => a.status === 'uploading');
  const canSend = !disabled && !uploading && (value.trim().length > 0 || (!busy && readyImages));

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
      class={cn('relative flex min-w-0 flex-col gap-2', className)}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      onDragOver={
        onAddFiles
          ? (e) => {
              if (!Array.from(e.dataTransfer?.types ?? []).includes('Files')) return;
              e.preventDefault();
              setDragging(true);
            }
          : undefined
      }
      onDragLeave={(e) => {
        if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setDragging(false);
      }}
      onDrop={
        onAddFiles
          ? (e) => {
              const files = imageFilesFrom(e.dataTransfer);
              setDragging(false);
              if (!files.length) return;
              e.preventDefault();
              onAddFiles(files);
            }
          : undefined
      }
    >
      {dragging && (
        <div class="pointer-events-none absolute inset-1 z-10 flex items-center justify-center rounded-2xl border-2 border-dashed border-[var(--color-accent)]/70 bg-[var(--color-bg)]/80 text-sm text-[var(--color-ink)]">
          Dépose l’image ici
        </div>
      )}
      {children}
      {replyTo && (
        <div class="flex min-w-0 items-center gap-2 rounded-lg border-l-2 border-[var(--color-accent)] bg-white/[0.04] py-1 pl-2 pr-1 text-xs text-[var(--color-ink-muted)]" data-reply-banner>
          <CornerDownRight size={13} class="shrink-0" aria-hidden />
          <span class="min-w-0 flex-1 truncate">
            <span class="text-[var(--color-ink-faint)]">En réponse à : </span>
            {replyTo.excerpt}
          </span>
          {onCancelReply && (
            <button
              type="button"
              class="df-hit df-tap-skip inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full hover:bg-white/10 hover:text-[var(--color-ink)]"
              aria-label="Annuler la réponse ciblée"
              onMouseDown={keepFocus}
              onClick={() => onCancelReply()}
            >
              <X size={12} strokeWidth={2.2} aria-hidden />
            </button>
          )}
        </div>
      )}
      {attachments.length > 0 && (
        <div class="flex flex-wrap gap-2" data-composer-attachments>
          {attachments.map((a) => (
            <div
              key={a.localId}
              class={cn(
                'relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-white/[0.04] ring-1 ring-inset',
                a.status === 'error' ? 'ring-[var(--color-danger)]' : 'ring-[var(--color-line)]',
              )}
              title={a.error ?? a.name}
            >
              <img src={a.previewUrl} alt={a.name} class={cn('h-full w-full object-cover', a.status !== 'ready' && 'opacity-60')} />
              {a.status === 'uploading' && (
                <span class="absolute inset-0 flex items-center justify-center" role="status" aria-label="Envoi de l’image…">
                  <Loader2 size={16} class="animate-spin text-white motion-reduce:animate-none" aria-hidden />
                </span>
              )}
              {a.status === 'error' && (
                <span class="absolute inset-0 flex items-center justify-center bg-black/40" aria-label={a.error ?? 'Échec'}>
                  <AlertCircle size={16} class="text-[var(--color-danger)]" aria-hidden />
                </span>
              )}
              {onRemoveAttachment && (
                <button
                  type="button"
                  class="df-tap-skip absolute right-0.5 top-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-white hover:bg-black"
                  aria-label={`Retirer l’image ${a.name}`}
                  onMouseDown={keepFocus}
                  onClick={() => onRemoveAttachment(a.localId)}
                >
                  <X size={11} strokeWidth={2.4} aria-hidden />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
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
        {onAddFiles && (
          <>
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPTED_IMAGE_TYPES.join(',')}
              multiple
              class="hidden"
              data-composer-file
              onChange={(e) => {
                const files = Array.from(e.currentTarget.files ?? []);
                e.currentTarget.value = '';
                if (files.length) onAddFiles(files);
              }}
            />
            <button
              type="button"
              disabled={disabled}
              class="df-tap-skip inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[var(--color-ink-muted)] transition hover:bg-white/5 hover:text-[var(--color-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] disabled:opacity-50 max-lg:h-11 max-lg:w-11"
              aria-label="Joindre une image"
              title="Joindre une image (ou coller une capture)"
              onMouseDown={keepFocus}
              onClick={() => fileRef.current?.click()}
            >
              <Paperclip size={18} strokeWidth={2} aria-hidden />
            </button>
          </>
        )}
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
          onPaste={
            onAddFiles
              ? (e) => {
                  const files = imageFilesFrom(e.clipboardData);
                  if (!files.length) return;
                  e.preventDefault();
                  onAddFiles(files);
                }
              : undefined
          }
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
