import { useEffect, useId } from 'preact/hooks';
import { cn } from '../lib/cn';
import { mobileSheetNav } from '../lib/nav';

type Props = {
  open: boolean;
  onClose: () => void;
  active?: string;
  userRole?: string | null;
};

export function MobileMenuSheet({ open, onClose, active, userRole }: Props) {
  const titleId = useId();

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

  const items = mobileSheetNav(userRole);

  return (
    <div
      class="fixed inset-0 z-50 flex items-end justify-center lg:hidden"
      style={{ paddingBottom: 'calc(4.5rem + env(safe-area-inset-bottom, 0px))' }}
    >
      <button
        type="button"
        aria-label="Fermer"
        class="df-modal-backdrop absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        class={cn(
          'df-sheet-panel relative z-10 flex w-full max-w-lg flex-col overflow-hidden border-t border-[var(--color-line)] bg-[var(--color-card)] shadow-2xl',
          'max-h-[min(75dvh,600px)] rounded-t-2xl',
        )}
      >
        <div class="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--color-line)] px-4 py-3">
          <h2 id={titleId} class="text-base font-medium tracking-tight text-[var(--color-ink)]">
            Menu
          </h2>
          <button
            type="button"
            class="shrink-0 rounded-lg px-2 py-1 text-sm text-[var(--color-ink-muted)] hover:bg-white/5 hover:text-[var(--color-ink)]"
            onClick={onClose}
            aria-label="Fermer"
          >
            ✕
          </button>
        </div>

        <nav
          class="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain px-4 py-4"
          style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom, 0px))' }}
        >
          {items.map((item) => {
            const isCurrent = active === item.key;
            return (
              <a
                key={item.key}
                href={item.href}
                class={cn(
                  'flex min-h-[44px] items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-[background-color,color,transform] duration-200 active:scale-[0.98]',
                  isCurrent
                    ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                    : 'text-[var(--color-ink-muted)] active:bg-white/5 active:text-[var(--color-ink)]',
                )}
                onClick={() => {
                  setTimeout(onClose, 100);
                }}
                aria-current={isCurrent ? 'page' : undefined}
              >
                {item.label}
              </a>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
