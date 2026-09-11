import type { ComponentChildren } from 'preact';
import { useEffect } from 'preact/hooks';
import { cn } from '../../lib/cn';

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ComponentChildren;
  class?: string;
  size?: 'md' | 'lg' | 'xl';
};

const sizes = {
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-3xl',
};

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  class: className,
  size = 'lg',
}: Props) {
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
    <div class="fixed inset-0 z-50 flex items-end justify-center p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:items-center sm:p-4">
      <button
        type="button"
        aria-label="Fermer"
        class="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="df-modal-title"
        class={cn(
          'relative z-10 flex max-h-[min(90dvh,880px)] w-full flex-col overflow-hidden rounded-2xl border border-[var(--color-line)] bg-[var(--color-card)] shadow-2xl',
          sizes[size],
          className,
        )}
      >
        <div class="flex items-start justify-between gap-3 border-b border-[var(--color-line)] px-5 py-4">
          <div class="min-w-0">
            <h2
              id="df-modal-title"
              class="text-base font-medium tracking-tight text-[var(--color-ink)]"
            >
              {title}
            </h2>
            {description && (
              <p class="mt-1 text-sm text-[var(--color-ink-muted)]">{description}</p>
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
        <div class="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}
