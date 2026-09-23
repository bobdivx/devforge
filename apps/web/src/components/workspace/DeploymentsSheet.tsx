import { useEffect, useState } from 'preact/hooks';
import { X, ListFilter, AlignLeft } from 'lucide-preact';
import { api, type Deployment } from '../../lib/api';
import { Badge, Button, Portal, Spinner } from '../ui';
import { cn } from '../../lib/cn';
import { DeployTimeline } from './DeployTimeline';

type Props = {
  open: boolean;
  onClose: () => void;
  projectUuid: string;
  variant?: 'sheet' | 'panel';
};

/** Chips visibles par défaut dans la feuille déploiements. */
const DEPLOYMENTS_VISIBLE_DEFAULT = 12;

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
  if (status === 'deployed' || status === 'success' || status === 'ok') return 'ok';
  if (status === 'failed' || status === 'error') return 'danger';
  if (
    status === 'deploying' ||
    status === 'building' ||
    status === 'pending' ||
    status === 'queued' ||
    status === 'running'
  ) {
    return 'warn';
  }
  return 'neutral';
}

type TraceEvent = {
  id: number;
  kind: string;
  status: string;
  ref_id?: string | null;
  detail: string;
  created_at: string;
};

export function DeploymentsSheet({ open, onClose, projectUuid, variant = 'sheet' }: Props) {
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [trace, setTrace] = useState<TraceEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedUuid, setSelectedUuid] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'timeline' | 'raw'>('timeline');
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
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
    if (open) loadDeployments();
  }, [open, projectUuid]);

  // Polling automatique si un déploiement est en cours
  useEffect(() => {
    if (!open) return;
    const active = deployments.some((d) =>
      ['deploying', 'building', 'pending', 'queued', 'running'].includes(d.status),
    );
    if (!active) return;

    const interval = setInterval(() => {
      loadDeployments(false);
    }, 1500);
    return () => clearInterval(interval);
  }, [open, selectedUuid, deployments]);

  async function loadDeployments(showSpinner = true) {
    if (showSpinner) setLoading(true);
    try {
      const r = await api.deployments(projectUuid);
      setDeployments(r.data ?? []);
      if (!selectedUuid && r.data?.[0]) setSelectedUuid(r.data[0].uuid);
    } catch {
      setDeployments([]);
    }
    try {
      const t = await api.projectTrace(projectUuid);
      setTrace(t.data ?? []);
    } catch {
      setTrace([]);
    } finally {
      if (showSpinner) setLoading(false);
    }
  }

  async function retryDeploy() {
    setRetrying(true);
    setRetryError(null);
    try {
      const r = await api.createDeployment(projectUuid, { git_message: 'Relance' });
      const uuid = r.data?.uuid;
      await loadDeployments(false);
      if (uuid) setSelectedUuid(uuid);
    } catch (err) {
      setRetryError(String((err as Error).message || err));
    } finally {
      setRetrying(false);
    }
  }

  if (!open) return null;

  const selected = deployments.find((d) => d.uuid === selectedUuid);

  const body = (
    <>
      {!isPanel && (
        <div class="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--color-line)] px-4 py-3 sm:px-5">
          <div class="min-w-0">
            <h2 class="text-base font-medium tracking-tight">Déploiements</h2>
            <p class="mt-0.5 text-xs text-[var(--color-ink-muted)]">
              Historique des publications vers l’environnement live
            </p>
          </div>
          <button
            type="button"
            class="rounded-lg p-1.5 text-[var(--color-ink-muted)] hover:bg-white/5 hover:text-[var(--color-ink)]"
            onClick={onClose}
            aria-label="Fermer"
          >
            <X size={16} strokeWidth={2} aria-hidden />
          </button>
        </div>
      )}

      <div
        class={cn(
          'flex min-h-0 flex-1 flex-col overflow-y-auto',
          isPanel ? 'h-full p-3 sm:p-4' : 'px-4 py-3 sm:px-5',
        )}
      >
        {trace.length > 0 && (
          <ol class="mb-4 space-y-1.5">
            <li class="text-[11px] font-medium uppercase tracking-wide text-[var(--color-ink-faint)]">
              Trace agent · déploiement · smoke
            </li>
            {trace.slice(0, 8).map((event) => (
              <li
                key={event.id}
                class="flex items-baseline gap-2 text-xs text-[var(--color-ink-muted)]"
              >
                <Badge tone={deployTone(event.status)}>{event.kind}</Badge>
                <span class="min-w-0 flex-1 truncate">{event.detail || event.ref_id || event.status}</span>
                <span class="shrink-0 text-[10px] text-[var(--color-ink-faint)]">
                  {formatWhen(event.created_at)}
                </span>
              </li>
            ))}
          </ol>
        )}

        {loading && deployments.length === 0 ? (
          <div class="flex items-center gap-2 text-sm text-[var(--color-ink-muted)]">
            <Spinner /> Chargement…
          </div>
        ) : deployments.length === 0 ? (
          <p class="text-sm text-[var(--color-ink-muted)]">Aucun déploiement.</p>
        ) : (
          <>
            <div class="mb-3 flex gap-1 overflow-x-auto pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {(showAll ? deployments : deployments.slice(0, DEPLOYMENTS_VISIBLE_DEFAULT)).map((d) => (
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
              {deployments.length > DEPLOYMENTS_VISIBLE_DEFAULT && (
                <button
                  type="button"
                  onClick={() => setShowAll((v) => !v)}
                  class="shrink-0 self-center rounded-lg border border-dashed border-[var(--color-line)] px-3 py-2 text-xs text-[var(--color-ink-muted)] hover:border-[var(--color-line-strong)] hover:text-[var(--color-ink)]"
                >
                  {showAll
                    ? 'Voir moins'
                    : `Voir plus (${deployments.length - DEPLOYMENTS_VISIBLE_DEFAULT})`}
                </button>
              )}
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
                  {selected.status === 'queued' && (
                    <p class="mt-2 text-sm text-[var(--color-ink-muted)]">
                      En attente : un autre déploiement occupe déjà ce nœud.
                    </p>
                  )}
                  {selected.error_summary && (
                    <p class="mt-2 text-sm text-[var(--color-ink)]">{selected.error_summary}</p>
                  )}
                  {selected.error_hint && (
                    <p class="mt-1 text-xs text-[var(--color-ink-muted)]">{selected.error_hint}</p>
                  )}
                  {(selected.status === 'failed' || selected.status === 'error') && (
                    <div class="mt-3 flex flex-wrap items-center gap-2">
                      <Button type="button" size="sm" disabled={retrying} onClick={retryDeploy}>
                        {retrying ? <Spinner /> : null}
                        Relancer
                      </Button>
                      {retryError && (
                        <span class="text-xs text-[var(--color-danger)]">{retryError}</span>
                      )}
                    </div>
                  )}
                </div>

                <div class="flex items-center justify-between gap-2 px-1">
                  <span class="text-xs font-medium text-[var(--color-ink-muted)]">Progression & Événements</span>
                  <div class="flex items-center gap-1 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-0.5 text-xs">
                    <button
                      type="button"
                      onClick={() => setViewMode('timeline')}
                      class={cn(
                        'flex items-center gap-1.5 rounded-md px-2.5 py-1 transition',
                        viewMode === 'timeline'
                          ? 'bg-[var(--color-accent)] text-white font-medium'
                          : 'text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]'
                      )}
                    >
                      <ListFilter size={13} />
                      <span>Timeline</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewMode('raw')}
                      class={cn(
                        'flex items-center gap-1.5 rounded-md px-2.5 py-1 transition',
                        viewMode === 'raw'
                          ? 'bg-[var(--color-accent)] text-white font-medium'
                          : 'text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]'
                      )}
                    >
                      <AlignLeft size={13} />
                      <span>Logs bruts</span>
                    </button>
                  </div>
                </div>

                {viewMode === 'timeline' ? (
                  <DeployTimeline logs={selected.logs} status={selected.status} />
                ) : (
                  <div class="rounded-xl border border-[var(--color-line)] bg-black/40 p-3">
                    <pre
                      class={cn(
                        'overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-[var(--color-ink-muted)]',
                        isPanel ? 'max-h-none' : 'max-h-[40vh]',
                      )}
                    >
                      {selected.logs || 'Aucun log disponible.'}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {!isPanel && (
        <div class="flex shrink-0 items-center justify-end gap-2 border-t border-[var(--color-line)] bg-[var(--color-card)] px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] sm:px-5">
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
    <Portal>
    <div class="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto sm:items-center">
      <button
        type="button"
        aria-label="Fermer"
        class="df-modal-backdrop absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        class={cn(
          'df-modal-panel relative z-10 flex w-full flex-col overflow-hidden border border-[var(--color-line)] bg-[var(--color-card)] shadow-2xl',
          'max-h-[calc(100dvh-4.5rem-env(safe-area-inset-bottom,0px))] sm:max-h-[80dvh]',
          'rounded-t-2xl border-b-0 sm:rounded-2xl sm:border',
          'max-w-2xl sm:max-w-3xl',
        )}
      >
        {body}
      </div>
    </div>
    </Portal>
  );
}
