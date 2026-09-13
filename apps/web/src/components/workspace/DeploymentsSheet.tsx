import { useEffect, useState } from 'preact/hooks';
import { api, type Deployment } from '../../lib/api';
import { Badge, Button, Spinner } from '../ui';
import { cn } from '../../lib/cn';

type Props = {
  open: boolean;
  onClose: () => void;
  projectUuid: string;
};

function formatWhen(iso?: string | null) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('fr-FR', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function deployTone(status: string): 'ok' | 'warn' | 'danger' | 'neutral' {
  if (status === 'deployed' || status === 'running' || status === 'success') return 'ok';
  if (status === 'failed' || status === 'error') return 'danger';
  if (status === 'deploying' || status === 'building' || status === 'pending') return 'warn';
  return 'neutral';
}

export function DeploymentsSheet({ open, onClose, projectUuid }: Props) {
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedUuid, setSelectedUuid] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (open) loadDeployments();
  }, [open, projectUuid]);

  async function loadDeployments() {
    setLoading(true);
    try {
      const r = await api.deployments(projectUuid);
      setDeployments(r.data ?? []);
      if (r.data?.[0]) setSelectedUuid(r.data[0].uuid);
    } catch {
      setDeployments([]);
    } finally {
      setLoading(false);
    }
  }

  if (!open) return null;

  const selected = deployments.find((d) => d.uuid === selectedUuid);

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
          <h2 class="text-base font-medium tracking-tight">Déploiements</h2>
          <button
            type="button"
            class="rounded-lg px-2 py-1 text-sm text-[var(--color-ink-muted)] hover:bg-white/5 hover:text-[var(--color-ink)]"
            onClick={onClose}
            aria-label="Fermer"
          >
            ✕
          </button>
        </div>

        <div class="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-3 sm:px-5">
          {loading && deployments.length === 0 ? (
            <div class="flex items-center gap-2 text-sm text-[var(--color-ink-muted)]">
              <Spinner /> Chargement…
            </div>
          ) : deployments.length === 0 ? (
            <p class="text-sm text-[var(--color-ink-muted)]">Aucun déploiement.</p>
          ) : (
            <>
              <div class="mb-3 flex gap-1 overflow-x-auto pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {deployments.map((d) => (
                  <button
                    key={d.uuid}
                    type="button"
                    onClick={() => setSelectedUuid(d.uuid)}
                    class={cn(
                      'shrink-0 rounded-lg border px-3 py-2 text-left transition',
                      selectedUuid === d.uuid
                        ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                        : 'border-[var(--color-line)] bg-[var(--color-surface)] hover:border-[var(--color-line-strong)]',
                    )}
                  >
                    <div class="flex items-center gap-2">
                      <Badge tone={deployTone(d.status)}>{d.status}</Badge>
                    </div>
                    <div class="mt-1 font-mono text-xs">
                      {d.git_sha ? d.git_sha.slice(0, 7) : '—'}
                    </div>
                    <div class="mt-0.5 text-[10px] text-[var(--color-ink-faint)]">
                      {formatWhen(d.created_at)}
                    </div>
                  </button>
                ))}
              </div>

              {selected && (
                <div class="flex-1 space-y-3">
                  <div class="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-3">
                    <div class="flex flex-wrap items-center gap-2">
                      <Badge tone={deployTone(selected.status)}>{selected.status}</Badge>
                      {selected.git_sha && (
                        <span class="font-mono text-xs text-[var(--color-ink-muted)]">
                          {selected.git_sha.slice(0, 7)}
                        </span>
                      )}
                      <span class="text-xs text-[var(--color-ink-faint)]">
                        {formatWhen(selected.created_at)}
                      </span>
                    </div>
                    {selected.git_message && (
                      <p class="mt-2 text-sm text-[var(--color-ink)]">{selected.git_message}</p>
                    )}
                  </div>

                  <div class="rounded-xl border border-[var(--color-line)] bg-black/40 p-3">
                    <pre class="max-h-[40vh] overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-[var(--color-ink-muted)]">
                      {selected.logs || 'Aucun log disponible.'}
                    </pre>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div class="flex shrink-0 items-center justify-end gap-2 border-t border-[var(--color-line)] bg-[var(--color-card)] px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] sm:px-5">
          <Button variant="ghost" onClick={onClose}>
            Fermer
          </Button>
        </div>
      </div>
    </div>
  );
}
