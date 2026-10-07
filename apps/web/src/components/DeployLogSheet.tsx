import type { ComponentChildren } from 'preact';
import { useEffect, useId, useRef } from 'preact/hooks';
import { ArrowLeft } from 'lucide-preact';
import { Portal } from './ui';

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Journal d'un déploiement en plein écran (téléphone).
 * « Retour », Échap ou le bouton retour du navigateur referment la feuille.
 */
export function DeployLogSheet({
  open,
  onClose,
  title,
  meta,
  actions,
  logs,
}: {
  open: boolean;
  onClose: () => void;
  title: ComponentChildren;
  meta?: ComponentChildren;
  actions?: ComponentChildren;
  logs: string;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Une entrée d'historique : le geste/bouton « retour » du téléphone ferme la feuille.
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    window.history.pushState({ dfDeploySheet: true }, '');
    const onPop = () => onCloseRef.current();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
        return;
      }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (active === first || !panelRef.current.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !panelRef.current.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('popstate', onPop);
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    backRef.current?.focus();
    return () => {
      window.removeEventListener('popstate', onPop);
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
      if (window.history.state?.dfDeploySheet) window.history.back();
      opener?.focus?.();
    };
  }, [open]);

  useEffect(() => {
    if (open && preRef.current) preRef.current.scrollTop = preRef.current.scrollHeight;
  }, [open, logs]);

  function close() {
    onCloseRef.current();
  }

  if (!open) return null;

  return (
    <Portal>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        class="df-sheet-panel fixed inset-0 z-50 flex flex-col bg-[var(--color-bg)]"
        style={{ paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        <div class="flex shrink-0 items-center gap-2 border-b border-[var(--color-line)] px-2 py-1.5">
          <button
            ref={backRef}
            type="button"
            class="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-xl px-3 text-sm text-[var(--color-ink-muted)] transition hover:bg-white/5 hover:text-[var(--color-ink)] focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]"
            onClick={close}
          >
            <ArrowLeft size={16} aria-hidden />
            Retour
          </button>
          <h2 id={titleId} class="min-w-0 flex-1 truncate text-sm font-medium">
            {title}
          </h2>
          {actions}
        </div>
        {meta && <div class="shrink-0 border-b border-[var(--color-line)] px-4 py-3">{meta}</div>}
        <pre
          ref={preRef}
          class="min-h-0 flex-1 overflow-auto overscroll-contain bg-black/40 p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]"
        >
          {logs || 'Aucun log disponible.'}
        </pre>
      </div>
    </Portal>
  );
}
