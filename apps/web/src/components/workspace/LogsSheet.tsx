import { useEffect, useState } from 'preact/hooks';
import { api, type Deployment } from '../../lib/api';
import { Button, Spinner } from '../ui';
import { cn } from '../../lib/cn';

type Props = {
  open: boolean;
  onClose: () => void;
  projectUuid: string;
};

export function LogsSheet({ open, onClose, projectUuid }: Props) {
  const [logs, setLogs] = useState<string>('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

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
        <div class="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--color-line)] px-4 py-3 sm:px-5">
          <h2 class="text-base font-medium tracking-tight">Logs du dernier déploiement</h2>
          <button
            type="button"
            class="rounded-lg px-2 py-1 text-sm text-[var(--color-ink-muted)] hover:bg-white/5 hover:text-[var(--color-ink)]"
            onClick={onClose}
            aria-label="Fermer"
          >
            ✕
          </button>
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto px-4 py-3 sm:px-5">
          {loading ? (
            <div class="flex items-center gap-2 text-sm text-[var(--color-ink-muted)]">
              <Spinner /> Chargement…
            </div>
          ) : (
            <div class="rounded-xl border border-[var(--color-line)] bg-black/40 p-3">
              <pre class="whitespace-pre-wrap break-words font-mono text-xs text-[var(--color-ink-muted)]">
                {logs}
              </pre>
            </div>
          )}
        </div>

        <div class="flex shrink-0 items-center justify-end gap-2 border-t border-[var(--color-line)] bg-[var(--color-card)] px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] sm:px-5">
          <Button variant="secondary" onClick={loadLatestLogs} disabled={loading}>
            Rafraîchir
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Fermer
          </Button>
        </div>
      </div>
    </div>
  );
}
