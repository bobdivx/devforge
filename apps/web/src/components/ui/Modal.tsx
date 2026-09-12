import type { ComponentChildren } from 'preact';
import { useEffect, useId } from 'preact/hooks';
import { cn } from '../../lib/cn';

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ComponentChildren;
  /** Actions sticky en bas (Annuler / Connecter…). Restent visibles hors scroll. */
  footer?: ComponentChildren;
  class?: string;
  /** Classes additionnelles sur la zone scrollable. */
  bodyClass?: string;
  /** Padding horizontal/vertical du body. Défaut true. */
  padded?: boolean;
  size?: 'sm' | 'md' | 'lg' | 'xl';
};

const sizes = {
  // Mobile : presque pleine largeur (parent). Desktop : largeurs utiles, pas des colonnes étroites.
  sm: 'max-w-md sm:max-w-lg',
  md: 'max-w-lg sm:max-w-xl md:max-w-2xl',
  lg: 'max-w-xl sm:max-w-2xl md:max-w-3xl',
  xl: 'max-w-2xl sm:max-w-3xl md:max-w-4xl lg:max-w-5xl',
};

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  class: className,
  bodyClass,
  padded = true,
  size = 'lg',
}: Props) {
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      class={cn(
        'fixed inset-0 z-50 flex justify-center',
        // Mobile : sheet bas d’écran ; desktop : centré
        'items-end p-0 sm:items-center sm:p-4',
      )}
    >
      <button
        type="button"
        aria-label="Fermer"
        class="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        class={cn(
          'relative z-10 flex w-full flex-col overflow-hidden border border-[var(--color-line)] bg-[var(--color-card)] shadow-2xl',
          // Hauteur bornée au viewport MOINS le dock mobile (4.5rem + safe area)
          // Sur mobile : laisse de la place pour le dock en bas (72px = 4.5rem)
          'max-h-[calc(100dvh-4.5rem-env(safe-area-inset-bottom,0px))] sm:max-h-[min(90dvh,880px)]',
          // Sheet mobile → panneau centré desktop
          'rounded-t-2xl border-b-0 sm:rounded-2xl sm:border',
          sizes[size],
          className,
        )}
      >
        <div class="flex shrink-0 items-start justify-between gap-3 border-b border-[var(--color-line)] px-4 py-3 sm:px-5 sm:py-4">
          <div class="min-w-0">
            <h2
              id={titleId}
              class="text-base font-medium tracking-tight text-[var(--color-ink)]"
            >
              {title}
            </h2>
            {description && (
              <p
                id={descId}
                class="mt-1 line-clamp-3 text-sm text-[var(--color-ink-muted)] sm:line-clamp-none"
              >
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            class="shrink-0 rounded-lg px-2 py-1 text-sm text-[var(--color-ink-muted)] hover:bg-white/5 hover:text-[var(--color-ink)]"
            onClick={onClose}
            aria-label="Fermer"
          >
            ✕
          </button>
        </div>

        <div
          class={cn(
            'min-h-0 flex-1 overflow-y-auto overscroll-contain',
            padded && 'px-4 py-3 sm:px-5 sm:py-4',
            // Safe area si pas de footer (sinon le footer l’absorbe)
            footer == null && 'pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] sm:pb-4',
            bodyClass,
          )}
        >
          {children}
        </div>

        {footer != null && (
          <div
            class={cn(
              'flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-[var(--color-line)]',
              'bg-[var(--color-card)] px-4 py-3 sm:px-5 sm:py-3.5',
              'pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] sm:pb-3.5',
            )}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
