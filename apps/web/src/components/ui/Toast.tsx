import { createContext } from 'preact';
import { useCallback, useContext, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { cn } from '../../lib/cn';
import { Portal } from './Portal';

export type ToastTone = 'info' | 'ok' | 'warn' | 'danger';

export type ToastItem = {
  id: string;
  title: string;
  detail?: string;
  tone: ToastTone;
  /** Bouton d'action (ex. « Annuler » après une suppression). */
  action?: { label: string; onClick: () => void };
  /** Durée d'affichage (ms). Défaut 4200, 10 s avec une action. */
  durationMs?: number;
};

type ToastApi = {
  push: (t: Omit<ToastItem, 'id'> & { id?: string }) => void;
  dismiss: (id: string) => void;
};

const ToastCtx = createContext<ToastApi | null>(null);

const toneCls: Record<ToastTone, string> = {
  info: 'border-[var(--color-line)] bg-[var(--color-surface)]',
  ok: 'border-emerald-500/30 bg-emerald-500/10',
  warn: 'border-amber-500/30 bg-amber-500/10',
  danger: 'border-red-500/30 bg-red-500/10',
};

export function ToastProvider({ children }: { children: ComponentChildren }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (t: Omit<ToastItem, 'id'> & { id?: string }) => {
      const id = t.id ?? `t_${Math.random().toString(36).slice(2, 9)}`;
      setItems((prev) => [...prev.slice(-4), { ...t, id }]);
      window.setTimeout(() => dismiss(id), t.durationMs ?? (t.action ? 10000 : 4200));
    },
    [dismiss],
  );

  return (
    <ToastCtx.Provider value={{ push, dismiss }}>
      {children}
      <Portal>
      <div class="pointer-events-none fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] right-3 z-[80] flex w-[min(calc(100%-1.5rem),20rem)] flex-col gap-2 lg:bottom-6 lg:right-4">
        {items.map((t) => (
          <div
            key={t.id}
            class={cn(
              'pointer-events-auto rounded-xl border px-3 py-2 shadow-lg backdrop-blur df-toast-in',
              toneCls[t.tone],
            )}
          >
            <div class="flex items-start justify-between gap-2">
              <div>
                <div class="text-sm font-medium">{t.title}</div>
                {t.detail && (
                  <div class="mt-0.5 text-xs text-[var(--color-ink-muted)]">{t.detail}</div>
                )}
                {t.action && (
                  <button
                    type="button"
                    class="mt-1.5 inline-flex min-h-[44px] items-center rounded-lg px-2 text-sm font-semibold text-[var(--color-accent)] hover:bg-white/5 sm:min-h-[32px]"
                    onClick={() => {
                      t.action?.onClick();
                      dismiss(t.id);
                    }}
                  >
                    {t.action.label}
                  </button>
                )}
              </div>
              <button
                type="button"
                class="text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]"
                onClick={() => dismiss(t.id)}
              >
                ×
              </button>
            </div>
          </div>
        ))}
      </div>
      </Portal>
    </ToastCtx.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastCtx);
  if (!ctx) {
    return {
      push: () => {},
      dismiss: () => {},
    };
  }
  return ctx;
}
