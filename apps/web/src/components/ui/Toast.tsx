import { createContext } from 'preact';
import { useCallback, useContext, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { cn } from '../../lib/cn';

export type ToastTone = 'info' | 'ok' | 'warn' | 'danger';

export type ToastItem = {
  id: string;
  title: string;
  detail?: string;
  tone: ToastTone;
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
      window.setTimeout(() => dismiss(id), 4200);
    },
    [dismiss],
  );

  return (
    <ToastCtx.Provider value={{ push, dismiss }}>
      {children}
      <div class="pointer-events-none fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] right-3 z-50 flex w-[min(calc(100%-1.5rem),20rem)] flex-col gap-2 lg:bottom-6 lg:right-4">
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
