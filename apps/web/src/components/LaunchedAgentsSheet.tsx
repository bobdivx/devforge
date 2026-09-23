import { useEffect, useId } from 'preact/hooks';
import { Portal } from './ui';
import { LaunchedAgentRows, useLaunchedAgents } from './LaunchedAgentsMenu';

type Props = {
  open: boolean;
  onClose: () => void;
};

/** Liste des agents lancés, à la place du bouton + sur mobile. */
export function LaunchedAgentsSheet({ open, onClose }: Props) {
  const titleId = useId();
  const agents = useLaunchedAgents();

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
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
    <Portal>
      <div
        class="fixed inset-0 z-50 flex items-end justify-center md:hidden"
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
          class="df-sheet-panel relative z-10 flex w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border-t border-[var(--color-line)] bg-[var(--color-card)] shadow-2xl max-h-[min(75dvh,600px)]"
        >
          <div class="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--color-line)] px-4 py-3">
            <h2 id={titleId} class="text-base font-medium tracking-tight text-[var(--color-ink)]">
              Agents lancés
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
          <div
            class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-2"
            style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom, 0px))' }}
          >
            <LaunchedAgentRows agents={agents} onOpen={onClose} />
          </div>
        </div>
      </div>
    </Portal>
  );
}
