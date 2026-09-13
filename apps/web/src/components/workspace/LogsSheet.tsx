import { useEffect, useState } from 'preact/hooks';
import { RefreshCw, X } from 'lucide-preact';
import { api } from '../../lib/api';
import { Button, Spinner } from '../ui';
import { cn } from '../../lib/cn';

type Props = {
  open: boolean;
  onClose: () => void;
  projectUuid: string;
  variant?: 'sheet' | 'panel';
};

export function LogsSheet({ open, onClose, projectUuid, variant = 'sheet' }: Props) {
  const [logs, setLogs] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const isPanel = variant === 'panel';

  useEffect(() => {
    if (!open || isPanel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose, isPanel]);

  useEffect(() => {
    if (open) loadLatestLogs();
  }, [open, projectUuid]);

  async function loadLatestLogs() {
    setLoading(true);
    try {
      const r = await api.deployments(projectUuid);
      const latest = r.data?.[0];
      if (latest) {
        const detail = await api.deployment(latest.uuid);
        setLogs(detail.data.logs || 'Aucun log disponible.');
      } else {
        setLogs('Aucun déploiement trouvé.');
      }
    } catch {
      setLogs('(logs indisponibles)');
    } finally {
      setLoading(false);
    }
  }

  if (!open) return null;

  const body = (
    <>
      <div
        class={cn(
          'flex shrink-0 items-center justify-between gap-3 border-b border-[var(--color-line)]',
          isPanel ? 'px-3 py-2 sm:px-4' : 'px-4 py-3 sm:px-5',
        )}
      >
        <div class="min-w-0">
          <h2 class="text-sm font-medium tracking-tight sm:text-base">
            Logs du dernier déploiement
          </h2>
          <p class="mt-0.5 text-xs text-[var(--color-ink-muted)]">
            Sortie de build / runtime de l’app déployée
          </p>
        </div>
        <div class="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={loadLatestLogs}
            disabled={loading}
            title="Rafraîchir"
            aria-label="Rafraîchir"
          >
            <RefreshCw size={14} strokeWidth={2} aria-hidden />
          </Button>
          {!isPanel && (
            <button
              type="button"
              class="rounded-lg p-1.5 text-[var(--color-ink-muted)] hover:bg-white/5 hover:text-[var(--color-ink)]"
              onClick={onClose}
              aria-label="Fermer"
            >
              <X size={16} strokeWidth={2} aria-hidden />
            </button>
          )}
        </div>
      </div>

      <div
        class={cn(
          'min-h-0 flex-1 overflow-y-auto',
          isPanel ? 'h-full p-3 sm:p-4' : 'px-4 py-3 sm:px-5',
        )}
      >
        {loading ? (
          <div class="flex items-center gap-2 text-sm text-[var(--color-ink-muted)]">
            <Spinner /> Chargement…
          </div>
        ) : (
          <div class="h-full rounded-xl border border-[var(--color-line)] bg-black/40 p-3">
            <pre class="whitespace-pre-wrap break-words font-mono text-xs text-[var(--color-ink-muted)]">
              {logs}
            </pre>
          </div>
        )}
      </div>

      {!isPanel && (
        <div class="flex shrink-0 items-center justify-end gap-2 border-t border-[var(--color-line)] bg-[var(--color-card)] px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] sm:px-5">
          <Button variant="secondary" onClick={loadLatestLogs} disabled={loading}>
            Rafraîchir
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Fermer
          </Button>
        </div>
      )}
    </>
  );

  if (isPanel) {
    return <div class="flex h-full min-h-0 flex-col overflow-hidden">{body}</div>;
  }

  return (
    <div class="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-label="Fermer"
        class="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        class={cn(
          'relative z-10 flex w-full flex-col overflow-hidden border border-[var(--color-line)] bg-[var(--color-card)] shadow-2xl',
          'max-h-[calc(100dvh-4.5rem-env(safe-area-inset-bottom,0px))] sm:max-h-[80dvh]',
          'rounded-t-2xl border-b-0 sm:rounded-2xl sm:border',
          'max-w-2xl sm:max-w-3xl',
        )}
      >
        {body}
      </div>
    </div>
  );
}
